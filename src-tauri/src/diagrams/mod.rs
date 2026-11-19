//! Local diagram rendering with installed command-line tools (PlantUML, D2).
//!
//! The preview's diagram plugins call `diagram_render_local`; when a tool is not installed the
//! web side falls back to the diagram server (in "auto" mode). The diagram source is passed on
//! stdin and the SVG read from stdout, so nothing is written to disk and no shell is involved.

use serde::Serialize;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// How long a single render may take before the process is killed.
pub const RENDER_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq)]
pub enum LocalRenderError {
    /// The tool could not be found or started; callers may try another renderer.
    NotInstalled(String),
    /// The tool ran but failed (usually a syntax error in the diagram).
    Failed(String),
}

impl LocalRenderError {
    /// Error string sent to the web side; the prefix tells unavailable tools from failures.
    pub fn to_bridge_string(&self) -> String {
        match self {
            Self::NotInstalled(message) => format!("not-installed: {message}"),
            Self::Failed(message) => format!("failed: {message}"),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub tool: String,
    pub command: String,
    pub available: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

/// Splits a command line into words, honouring double and single quotes
/// (`"C:\Program Files\PlantUML\plantuml.jar"`).
pub fn split_command(spec: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut has_word = false;

    for ch in spec.chars() {
        match (quote, ch) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => current.push(c),
            (None, '"' | '\'') => {
                quote = Some(ch);
                has_word = true;
            }
            (None, c) if c.is_whitespace() => {
                if has_word {
                    words.push(std::mem::take(&mut current));
                    has_word = false;
                }
            }
            (None, c) => {
                current.push(c);
                has_word = true;
            }
        }
    }
    if has_word {
        words.push(current);
    }
    words
}

/// Finds an executable by name on PATH. On Windows also tries `.exe`, `.cmd` and `.bat`
/// (package managers install PlantUML as `plantuml.cmd`), which `Command` does not do itself.
pub fn find_executable(name: &str) -> Option<PathBuf> {
    let candidate = Path::new(name);
    if candidate.components().count() > 1 || candidate.is_absolute() {
        return candidate.is_file().then(|| candidate.to_path_buf());
    }

    let extensions: &[&str] = if cfg!(windows) {
        &["", ".exe", ".cmd", ".bat", ".com"]
    } else {
        &[""]
    };

    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for ext in extensions {
            let full = dir.join(format!("{name}{ext}"));
            if full.is_file() {
                return Some(full);
            }
        }
    }

    // GUI apps on macOS start with a minimal PATH; check the usual package-manager locations.
    if cfg!(target_os = "macos") {
        for dir in ["/opt/homebrew/bin", "/usr/local/bin"] {
            let full = Path::new(dir).join(name);
            if full.is_file() {
                return Some(full);
            }
        }
    }
    None
}

/// Resolves a configured command (`plantuml`, `C:\tools\plantuml.jar`, `java -jar x.jar`, `d2`)
/// to a program and its leading arguments.
pub fn resolve_command(spec: &str) -> Result<(PathBuf, Vec<String>), LocalRenderError> {
    let words = split_command(spec.trim());
    let Some((first, rest)) = words.split_first() else {
        return Err(LocalRenderError::NotInstalled("no command configured".to_string()));
    };

    if first.to_lowercase().ends_with(".jar") {
        if !Path::new(first).is_file() {
            return Err(LocalRenderError::NotInstalled(format!("{first} not found")));
        }
        let java = find_executable("java")
            .ok_or_else(|| LocalRenderError::NotInstalled("java not found (needed for the PlantUML .jar)".to_string()))?;
        let mut args = vec!["-jar".to_string(), first.clone()];
        args.extend(rest.iter().cloned());
        return Ok((java, args));
    }

    let program = find_executable(first)
        .ok_or_else(|| LocalRenderError::NotInstalled(format!("'{first}' was not found on PATH")))?;
    Ok((program, rest.to_vec()))
}

/// Runs a program with `input` on stdin and returns stdout, killing it after `timeout`.
pub fn run_with_timeout(
    program: &Path,
    args: &[String],
    input: &[u8],
    timeout: Duration,
) -> Result<Vec<u8>, LocalRenderError> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: do not flash a console window for every render.
        command.creation_flags(0x0800_0000);
    }

    let mut child = command
        .spawn()
        .map_err(|e| LocalRenderError::NotInstalled(format!("could not start {}: {e}", program.display())))?;

    // Feed stdin and drain stdout/stderr on threads so a large diagram cannot deadlock the pipes.
    let mut stdin = child.stdin.take();
    let payload = input.to_vec();
    let writer = std::thread::spawn(move || {
        if let Some(pipe) = stdin.as_mut() {
            let _ = pipe.write_all(&payload);
        }
        drop(stdin);
    });
    let mut stdout = child.stdout.take();
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(pipe) = stdout.as_mut() {
            let _ = pipe.read_to_end(&mut buf);
        }
        buf
    });
    let mut stderr = child.stderr.take();
    let err_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(pipe) = stderr.as_mut() {
            let _ = pipe.read_to_end(&mut buf);
        }
        buf
    });

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(LocalRenderError::Failed(format!(
                    "timed out after {} seconds",
                    timeout.as_secs()
                )));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(15)),
            Err(e) => return Err(LocalRenderError::Failed(e.to_string())),
        }
    };

    let _ = writer.join();
    let output = reader.join().unwrap_or_default();
    let errors = err_reader.join().unwrap_or_default();

    if !status.success() {
        let message = String::from_utf8_lossy(&errors).trim().to_string();
        let message = if message.is_empty() {
            String::from_utf8_lossy(&output).trim().to_string()
        } else {
            message
        };
        return Err(LocalRenderError::Failed(if message.is_empty() {
            format!("exited with {status}")
        } else {
            message.chars().take(600).collect()
        }));
    }
    Ok(output)
}

/// Extracts the `<svg>…</svg>` document from tool output (tools may print an XML prolog).
fn extract_svg(output: &[u8]) -> Result<String, LocalRenderError> {
    let text = String::from_utf8_lossy(output);
    let start = text.find("<svg");
    let end = text.rfind("</svg>");
    match (start, end) {
        (Some(start), Some(end)) if end > start => Ok(text[start..end + 6].to_string()),
        _ => Err(LocalRenderError::Failed(
            "the tool did not return an SVG image".to_string(),
        )),
    }
}

/// Arguments that make each tool read the diagram from stdin and write SVG to stdout.
pub fn tool_arguments(tool: &str) -> Option<Vec<String>> {
    match tool {
        "plantuml" => Some(vec!["-tsvg".into(), "-pipe".into(), "-charset".into(), "UTF-8".into()]),
        "d2" => Some(vec!["-".into(), "-".into()]),
        _ => None,
    }
}

/// Maps a fenced-code language to the local tool that renders it.
pub fn tool_for_language(lang: &str) -> Option<&'static str> {
    match lang.to_ascii_lowercase().as_str() {
        "plantuml" | "puml" | "uml" => Some("plantuml"),
        "d2" => Some("d2"),
        _ => None,
    }
}

/// Renders `source` with the local tool for `lang`, using the configured command for that tool.
pub fn render_local(lang: &str, source: &str, command_for: impl Fn(&str) -> String) -> Result<String, LocalRenderError> {
    let tool = tool_for_language(lang)
        .ok_or_else(|| LocalRenderError::NotInstalled(format!("no local renderer for '{lang}'")))?;
    let (program, mut args) = resolve_command(&command_for(tool))?;
    args.extend(tool_arguments(tool).unwrap_or_default());
    let output = run_with_timeout(&program, &args, source.as_bytes(), RENDER_TIMEOUT)?;
    extract_svg(&output)
}

/// Reports whether each local tool can be found and which version it is.
pub fn tool_status(tool: &str, command_spec: &str) -> ToolStatus {
    let mut status = ToolStatus {
        tool: tool.to_string(),
        command: command_spec.to_string(),
        available: false,
        version: None,
        error: None,
    };

    match resolve_command(command_spec) {
        Ok((program, mut args)) => {
            args.push(if tool == "plantuml" { "-version".into() } else { "--version".into() });
            match run_with_timeout(&program, &args, b"", Duration::from_secs(20)) {
                Ok(output) => {
                    status.available = true;
                    status.version = String::from_utf8_lossy(&output)
                        .lines()
                        .map(str::trim)
                        .find(|line| !line.is_empty())
                        .map(|line| line.chars().take(120).collect());
                }
                Err(err) => status.error = Some(err.to_bridge_string()),
            }
        }
        Err(err) => status.error = Some(err.to_bridge_string()),
    }
    status
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_quoted_command_lines() {
        assert_eq!(split_command("plantuml"), vec!["plantuml"]);
        assert_eq!(
            split_command(r#"java -jar "C:\Program Files\PlantUML\plantuml.jar""#),
            vec!["java", "-jar", r"C:\Program Files\PlantUML\plantuml.jar"]
        );
        assert_eq!(split_command("  d2   --layout=elk "), vec!["d2", "--layout=elk"]);
        assert_eq!(split_command("''"), vec![""]);
        assert!(split_command("   ").is_empty());
    }

    #[test]
    fn missing_tools_are_reported_as_not_installed() {
        let err = resolve_command("definitely-not-a-real-diagram-tool-xyz").unwrap_err();
        assert!(matches!(err, LocalRenderError::NotInstalled(_)));
        assert!(err.to_bridge_string().starts_with("not-installed:"));
        assert!(matches!(resolve_command("  "), Err(LocalRenderError::NotInstalled(_))));
        assert!(matches!(resolve_command("/no/such/plantuml.jar"), Err(LocalRenderError::NotInstalled(_))));

        let err = render_local("d2", "a -> b", |_| "definitely-not-a-real-diagram-tool-xyz".to_string()).unwrap_err();
        assert!(matches!(err, LocalRenderError::NotInstalled(_)));
        assert!(matches!(render_local("python", "x", |_| "d2".to_string()), Err(LocalRenderError::NotInstalled(_))));
    }

    #[test]
    fn extracts_svg_from_tool_output() {
        let svg = extract_svg(b"<?xml version=\"1.0\"?>\n<svg a=\"1\"><g/></svg>\n").expect("svg");
        assert_eq!(svg, "<svg a=\"1\"><g/></svg>");
        assert!(extract_svg(b"error: bad diagram").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn runs_processes_with_stdin_and_timeout() {
        let cat = find_executable("cat").expect("cat");
        let output = run_with_timeout(&cat, &[], "<svg>한글</svg>".as_bytes(), Duration::from_secs(5)).expect("cat");
        assert_eq!(String::from_utf8(output).unwrap(), "<svg>한글</svg>");

        let sh = find_executable("sh").expect("sh");
        let failed = run_with_timeout(&sh, &["-c".into(), "echo bad >&2; exit 3".into()], b"", Duration::from_secs(5)).unwrap_err();
        assert_eq!(failed, LocalRenderError::Failed("bad".to_string()));

        let slow = run_with_timeout(&sh, &["-c".into(), "sleep 5".into()], b"", Duration::from_millis(200)).unwrap_err();
        assert!(matches!(slow, LocalRenderError::Failed(message) if message.contains("timed out")));
    }

    /// Exercises the real tools when they are installed (skipped otherwise).
    #[test]
    fn renders_with_installed_tools_when_available() {
        if find_executable("d2").is_some() {
            let svg = render_local("d2", "a -> b", |_| "d2".to_string()).expect("d2 render");
            assert!(svg.starts_with("<svg"));
        }
        if find_executable("plantuml").is_some() {
            let svg = render_local("plantuml", "@startuml\nA -> B: 안녕\n@enduml\n", |_| "plantuml".to_string())
                .expect("plantuml render");
            assert!(svg.starts_with("<svg") && svg.contains("안녕"));
        }
    }
}
