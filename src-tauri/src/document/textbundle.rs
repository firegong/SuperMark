use serde_json::json;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const DEFAULT_INFO_JSON: &str = r#"{
  "version": 2,
  "type": "net.daringfireball.markdown",
  "creatorIdentifier": "app.markedit.windows"
}"#;

pub fn is_textbundle_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("textbundle"))
        .unwrap_or(false)
}

pub fn is_textpack_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("textpack"))
        .unwrap_or(false)
}

/// Reads markdown content from a `.textbundle` directory.
pub fn read_textbundle(dir_path: &Path) -> Result<String, String> {
    let candidates = ["text.md", "text.markdown", "text.txt"];
    for name in candidates {
        let candidate = dir_path.join(name);
        if candidate.is_file() {
            return fs::read_to_string(&candidate).map_err(|e| e.to_string());
        }
    }
    Err(format!(
        "No text.md or text.markdown found inside textbundle: {}",
        dir_path.display()
    ))
}

/// Writes markdown content to a `.textbundle` directory while preserving `assets/` and `info.json`.
pub fn write_textbundle(dir_path: &Path, markdown_text: &str) -> Result<(), String> {
    fs::create_dir_all(dir_path).map_err(|e| e.to_string())?;
    let assets_dir = dir_path.join("assets");
    if !assets_dir.exists() {
        fs::create_dir_all(&assets_dir).map_err(|e| e.to_string())?;
    }

    let info_path = dir_path.join("info.json");
    if !info_path.exists() {
        fs::write(&info_path, DEFAULT_INFO_JSON.as_bytes()).map_err(|e| e.to_string())?;
    }

    // Preserve `text.markdown` filename if it already exists, otherwise default to `text.md`
    let target_text_file = if dir_path.join("text.markdown").is_file() {
        dir_path.join("text.markdown")
    } else {
        dir_path.join("text.md")
    };

    fs::write(&target_text_file, markdown_text.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

/// Reads markdown content from a `.textpack` ZIP archive.
pub fn read_textpack(zip_path: &Path) -> Result<String, String> {
    let file = File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if name.ends_with("text.md") || name.ends_with("text.markdown") || name.ends_with("text.txt")
        {
            let mut content = String::new();
            entry
                .read_to_string(&mut content)
                .map_err(|e| e.to_string())?;
            return Ok(content);
        }
    }

    Err(format!(
        "No text.md or text.markdown entry found in textpack: {}",
        zip_path.display()
    ))
}

/// Writes markdown content to a `.textpack` ZIP archive while preserving existing `assets/*` and `info.json`.
pub fn write_textpack(zip_path: &Path, markdown_text: &str) -> Result<(), String> {
    let mut preserved_entries: HashMap<String, Vec<u8>> = HashMap::new();
    let mut text_entry_name = "text.md".to_string();

    if zip_path.is_file() {
        if let Ok(existing_file) = File::open(zip_path) {
            if let Ok(mut archive) = ZipArchive::new(existing_file) {
                for i in 0..archive.len() {
                    if let Ok(mut entry) = archive.by_index(i) {
                        if entry.is_dir() {
                            continue;
                        }
                        let name = entry.name().to_string();
                        if name.ends_with("text.md")
                            || name.ends_with("text.markdown")
                            || name.ends_with("text.txt")
                        {
                            text_entry_name = name;
                            continue;
                        }
                        let mut buf = Vec::new();
                        if entry.read_to_end(&mut buf).is_ok() {
                            preserved_entries.insert(name, buf);
                        }
                    }
                }
            }
        }
    }

    if !preserved_entries.keys().any(|k| k.ends_with("info.json")) {
        let info = json!({
            "version": 2,
            "type": "net.daringfireball.markdown",
            "creatorIdentifier": "app.markedit.windows"
        });
        preserved_entries.insert(
            "info.json".to_string(),
            serde_json::to_vec_pretty(&info).unwrap_or_else(|_| DEFAULT_INFO_JSON.as_bytes().to_vec()),
        );
    }

    if let Some(parent) = zip_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let tmp_path = zip_path.with_extension("textpack.tmp");
    {
        let out_file = File::create(&tmp_path).map_err(|e| e.to_string())?;
        let mut zip = ZipWriter::new(out_file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

        for (name, bytes) in &preserved_entries {
            zip.start_file(name, options).map_err(|e| e.to_string())?;
            zip.write_all(bytes).map_err(|e| e.to_string())?;
        }

        zip.start_file(&text_entry_name, options)
            .map_err(|e| e.to_string())?;
        zip.write_all(markdown_text.as_bytes())
            .map_err(|e| e.to_string())?;
        zip.finish().map_err(|e| e.to_string())?;
    }

    fs::rename(&tmp_path, zip_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn textbundle_directory_roundtrip_preserves_assets() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let bundle_dir = tmp.path().join("Sample.textbundle");

        write_textbundle(&bundle_dir, "# Hello TextBundle\n\nBody.").expect("write textbundle");
        let asset_file = bundle_dir.join("assets").join("diagram.png");
        fs::write(&asset_file, b"PNG_BYTES").expect("write asset");

        let loaded = read_textbundle(&bundle_dir).expect("read textbundle");
        assert_eq!(loaded, "# Hello TextBundle\n\nBody.");

        write_textbundle(&bundle_dir, "# Updated TextBundle").expect("update textbundle");
        assert_eq!(
            read_textbundle(&bundle_dir).expect("read updated"),
            "# Updated TextBundle"
        );
        assert_eq!(fs::read(&asset_file).expect("asset still exists"), b"PNG_BYTES");
    }

    #[test]
    fn textpack_zip_roundtrip_preserves_extra_entries() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pack_path = tmp.path().join("Archive.textpack");

        write_textpack(&pack_path, "# Initial TextPack\nContent").expect("write textpack");
        let loaded = read_textpack(&pack_path).expect("read textpack");
        assert_eq!(loaded, "# Initial TextPack\nContent");

        write_textpack(&pack_path, "# Revised TextPack").expect("update textpack");
        let updated = read_textpack(&pack_path).expect("read updated textpack");
        assert_eq!(updated, "# Revised TextPack");
    }
}
