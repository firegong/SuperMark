use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitChange {
    pub path: String,
    pub index_status: String,    // staged status char (M, A, D, R, C, .)
    pub worktree_status: String, // unstaged status char
    pub untracked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStatus {
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub changes: Vec<GitChange>,
    pub is_repo: bool,
}

fn run_git(folder: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(folder)
        .args(args)
        .output()
        .map_err(|e| format!("failed to run git: {}", e))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        return Err(if stderr.trim().is_empty() { stdout } else { stderr });
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

pub fn is_repo(folder: &str) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(folder)
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn status(folder: &str) -> Result<GitStatus, String> {
    if !is_repo(folder) {
        return Ok(GitStatus {
            branch: String::new(),
            upstream: None,
            ahead: 0,
            behind: 0,
            changes: vec![],
            is_repo: false,
        });
    }
    let out = run_git(folder, &["status", "--porcelain=v2", "--branch"])?;
    let mut branch = String::new();
    let mut upstream = None;
    let mut ahead = 0usize;
    let mut behind = 0usize;
    let mut changes: Vec<GitChange> = Vec::new();

    for line in out.lines() {
        if line.starts_with("# branch.head ") {
            branch = line.trim_start_matches("# branch.head ").to_string();
            if branch == "(detached)" {
                branch = "HEAD (detached)".to_string();
            }
        } else if line.starts_with("# branch.upstream ") {
            upstream = Some(line.trim_start_matches("# branch.upstream ").to_string());
        } else if line.starts_with("# branch.ab ") {
            let ab = line.trim_start_matches("# branch.ab ");
            // format: +N -M
            let parts: Vec<&str> = ab.split_whitespace().collect();
            if parts.len() >= 2 {
                ahead = parts[0].trim_start_matches('+').parse().unwrap_or(0);
                behind = parts[1].trim_start_matches('-').parse().unwrap_or(0);
            }
        } else if line.starts_with("? ") {
            let path = line.trim_start_matches("? ").to_string();
            changes.push(GitChange {
                path,
                index_status: ".".to_string(),
                worktree_status: "?".to_string(),
                untracked: true,
            });
        } else if line.starts_with("1 ") || line.starts_with("2 ") {
            // ordinary/renamed
            let fields: Vec<&str> = line.split_whitespace().collect();
            // fields: status XY, sub, mH, mI, mW, hH, hI, path (or orig path)
            if fields.len() >= 9 {
                let xy = fields[1];
                let idx = xy.chars().next().unwrap_or('.').to_string();
                let wt = xy.chars().nth(1).unwrap_or('.').to_string();
                let path = fields[8..].join(" ");
                changes.push(GitChange {
                    path,
                    index_status: idx,
                    worktree_status: wt,
                    untracked: false,
                });
            }
        }
    }

    Ok(GitStatus {
        branch,
        upstream,
        ahead,
        behind,
        changes,
        is_repo: true,
    })
}

pub fn diff(folder: &str, path: &str, staged: bool) -> Result<String, String> {
    if staged {
        run_git(folder, &["diff", "--cached", "--", path])
    } else {
        run_git(folder, &["diff", "--", path])
    }
}

pub fn stage(folder: &str, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    // build command manually
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(folder).arg("add").arg("--");
    for p in paths {
        cmd.arg(p);
    }
    let out = cmd.output().map_err(|e| format!("git add failed: {}", e))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

pub fn unstage(folder: &str, paths: &[String]) -> Result<(), String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(folder).arg("restore").arg("--staged").arg("--");
    for p in paths {
        cmd.arg(p);
    }
    if paths.is_empty() {
        return Ok(());
    }
    let out = cmd.output().map_err(|e| format!("git restore failed: {}", e))?;
    if !out.status.success() {
        // fallback to reset HEAD
        let mut cmd2 = Command::new("git");
        cmd2.arg("-C").arg(folder).arg("reset").arg("HEAD").arg("--");
        for p in paths {
            cmd2.arg(p);
        }
        let out2 = cmd2.output().map_err(|e| format!("git reset failed: {}", e))?;
        if !out2.status.success() {
            return Err(String::from_utf8_lossy(&out2.stderr).to_string());
        }
    }
    Ok(())
}

pub fn commit(folder: &str, message: &str) -> Result<String, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(folder)
        .args(["commit", "-m", message])
        .output()
        .map_err(|e| format!("git commit failed: {}", e))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

pub fn branches(folder: &str) -> Result<Vec<String>, String> {
    let out = run_git(folder, &["branch", "--format=%(refname:short)"])?;
    Ok(out.lines().map(|l| l.to_string()).filter(|l| !l.is_empty()).collect())
}

pub fn checkout(folder: &str, branch: &str) -> Result<(), String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(folder)
        .args(["checkout", branch])
        .output()
        .map_err(|e| format!("git checkout failed: {}", e))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

pub fn discard(folder: &str, paths: &[String]) -> Result<(), String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(folder).arg("checkout").arg("--");
    for p in paths {
        cmd.arg(p);
    }
    if paths.is_empty() {
        return Ok(());
    }
    let out = cmd.output().map_err(|e| format!("git checkout failed: {}", e))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

#[cfg(test)]
mod git_tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn init_repo(dir: &std::path::Path) {
        Command::new("git").arg("-C").arg(dir).args(["init"]).output().unwrap();
        Command::new("git").arg("-C").arg(dir).args(["config", "user.email", "t@t.com"]).output().unwrap();
        Command::new("git").arg("-C").arg(dir).args(["config", "user.name", "tester"]).output().unwrap();
    }

    #[test]
    fn status_on_non_repo() {
        let dir = tempdir().unwrap();
        let s = status(dir.path().to_str().unwrap()).unwrap();
        assert!(!s.is_repo);
    }

    #[test]
    fn status_tracks_changes() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        fs::write(dir.path().join("a.md"), "hello").unwrap();
        let s = status(dir.path().to_str().unwrap()).unwrap();
        assert!(s.is_repo);
        assert_eq!(s.changes.len(), 1);
        assert!(s.changes[0].untracked);
    }

    #[test]
    fn stage_commit_flow() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        fs::write(dir.path().join("a.md"), "hello").unwrap();
        stage(dir.path().to_str().unwrap(), &["a.md".to_string()]).unwrap();
        let s = status(dir.path().to_str().unwrap()).unwrap();
        assert!(s.changes.iter().any(|c| c.index_status == "A"));
        let msg = commit(dir.path().to_str().unwrap(), "initial").unwrap();
        assert!(msg.contains("initial") || msg.contains("1 file"));
        let s2 = status(dir.path().to_str().unwrap()).unwrap();
        assert!(s2.changes.is_empty());
    }

    #[test]
    fn diff_and_branches() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        fs::write(dir.path().join("a.md"), "hello").unwrap();
        stage(dir.path().to_str().unwrap(), &["a.md".to_string()]).unwrap();
        commit(dir.path().to_str().unwrap(), "initial").unwrap();
        fs::write(dir.path().join("a.md"), "hello world").unwrap();
        let d = diff(dir.path().to_str().unwrap(), "a.md", false).unwrap();
        assert!(d.contains("+hello world") || d.contains("hello world"));
        // branch
        Command::new("git").arg("-C").arg(dir.path()).args(["branch", "dev"]).output().unwrap();
        let bs = branches(dir.path().to_str().unwrap()).unwrap();
        assert!(bs.contains(&"dev".to_string()) || bs.contains(&"main".to_string()) || bs.contains(&"master".to_string()));
    }

    #[test]
    fn unstage_and_discard() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        fs::write(dir.path().join("a.md"), "hello").unwrap();
        stage(dir.path().to_str().unwrap(), &["a.md".to_string()]).unwrap();
        unstage(dir.path().to_str().unwrap(), &["a.md".to_string()]).unwrap();
        let s = status(dir.path().to_str().unwrap()).unwrap();
        assert!(s.changes.iter().any(|c| c.worktree_status == "?" || c.worktree_status == "M" || c.index_status == "."));
        // discard untracked not applicable; test discard on tracked
        Command::new("git").arg("-C").arg(dir.path()).args(["add", "a.md"]).output().unwrap();
        Command::new("git").arg("-C").arg(dir.path()).args(["commit", "-m", "i"]).output().unwrap();
        fs::write(dir.path().join("a.md"), "changed").unwrap();
        discard(dir.path().to_str().unwrap(), &["a.md".to_string()]).unwrap();
        let content = fs::read_to_string(dir.path().join("a.md")).unwrap();
        assert_eq!(content, "hello");
    }
}
