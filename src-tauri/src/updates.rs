//! In-app updates from the public releases repository (`firegong/SuperMark-releases`).
//!
//! Releases are built and signed by `.github/workflows/release.yml` (tauri-action with
//! `createUpdaterArtifacts`), which also uploads `latest.json`; `tauri.conf.json` points the
//! updater plugin at that file and holds the public key that verifies every download.
//!
//! - Help/app menu "Check for Updates…": always answers (up to date, error, or the offer).
//! - At startup (release builds, `general.checkForUpdates`, default on): quietly, once; a version
//!   the user chose to skip is not offered again.
//! - Installing restarts the app, so it waits until every document is saved.
//! - The portable Windows build (feature `portable`, a single exe without an installer) cannot
//!   replace itself: it offers the download page instead.

use crate::document::DocumentManager;
use crate::settings::SettingsManager;
use rfd::{AsyncMessageDialog, MessageButtons, MessageDialogResult, MessageLevel};
use serde_json::json;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_updater::UpdaterExt;

/// Where people can download releases by hand.
pub const RELEASES_PAGE: &str = "https://github.com/firegong/SuperMark-releases/releases";

/// The single-file build: updates are downloaded by hand.
pub const PORTABLE: bool = cfg!(feature = "portable");

/// Longest release notes shown in the dialog.
const MAX_NOTES_CHARS: usize = 1200;

/// What the user chose in the update dialog.
#[derive(Debug, PartialEq, Eq)]
pub enum UpdateChoice {
    Install,
    Later,
    Skip,
}

/// Yes / No / Cancel (custom button labels are not available on Windows): explained in the text.
pub fn choice_for(result: &MessageDialogResult) -> UpdateChoice {
    match result {
        MessageDialogResult::Yes | MessageDialogResult::Ok => UpdateChoice::Install,
        MessageDialogResult::Cancel => UpdateChoice::Skip,
        _ => UpdateChoice::Later,
    }
}

/// Release notes trimmed for a dialog.
pub fn notes_excerpt(body: Option<&str>) -> String {
    let notes = body.unwrap_or("").trim();
    if notes.chars().count() <= MAX_NOTES_CHARS {
        return notes.to_string();
    }
    let cut: String = notes.chars().take(MAX_NOTES_CHARS).collect();
    format!("{cut}…")
}

/// The update dialog's text.
pub fn offer_message(version: &str, current: &str, notes: &str, portable: bool) -> String {
    let separator = if notes.is_empty() { "" } else { "\n\n" };
    let choices = if portable {
        "This portable copy cannot update itself.\n\nYes: open the download page\nNo: remind me later\nCancel: skip this version"
    } else {
        "Yes: download and install now (SuperMark restarts)\nNo: remind me later\nCancel: skip this version"
    };
    format!("SuperMark {version} is available (you have {current}).\n\n{notes}{separator}{choices}")
}

/// Whether the automatic check should offer `version` (not skipped by the user).
pub fn should_offer(version: &str, skipped: &str, interactive: bool) -> bool {
    interactive || version != skipped
}

async fn info(title: &str, message: String) {
    AsyncMessageDialog::new()
        .set_title(title)
        .set_description(message)
        .set_level(MessageLevel::Info)
        .set_buttons(MessageButtons::Ok)
        .show()
        .await;
}

/// Checks for an update in the background. `interactive`: started from the menu, so every
/// outcome is reported; otherwise only an available update is.
pub fn check_for_updates<R: Runtime>(app: AppHandle<R>, interactive: bool) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run(&app, interactive).await {
            crate::diagnostics::log(&format!("update check failed: {error}"));
            if interactive {
                info(
                    "SuperMark",
                    format!("Could not check for updates.\n\n{error}\n\nReleases: {RELEASES_PAGE}"),
                )
                .await;
            }
        }
    });
}

async fn run<R: Runtime>(app: &AppHandle<R>, interactive: bool) -> Result<(), String> {
    let updater = app.updater().map_err(|error| error.to_string())?;
    let Some(update) = updater.check().await.map_err(|error| error.to_string())? else {
        if interactive {
            info(
                "SuperMark",
                format!("SuperMark {} is the latest version.", env!("CARGO_PKG_VERSION")),
            )
            .await;
        }
        return Ok(());
    };

    let settings = SettingsManager::new().load_user_settings();
    if !should_offer(&update.version, &settings.skipped_update_version, interactive) {
        return Ok(());
    }

    let notes = notes_excerpt(update.body.as_deref());
    let answer = AsyncMessageDialog::new()
        .set_title("SuperMark Update")
        .set_description(offer_message(&update.version, &update.current_version, &notes, PORTABLE))
        .set_level(MessageLevel::Info)
        .set_buttons(MessageButtons::YesNoCancel)
        .show()
        .await;

    match choice_for(&answer) {
        UpdateChoice::Later => return Ok(()),
        UpdateChoice::Skip => {
            let _ = SettingsManager::new()
                .update_user_settings(&json!({ "general.skippedUpdateVersion": update.version }));
            return Ok(());
        }
        UpdateChoice::Install => {}
    }

    if PORTABLE {
        crate::menu::open_in_shell(RELEASES_PAGE);
        return Ok(());
    }

    // Installing restarts the app: unsaved text would only survive as a crash backup.
    if app.state::<DocumentManager>().has_unsaved_changes() {
        info(
            "SuperMark Update",
            "Save your documents first, then choose Check for Updates again.".to_string(),
        )
        .await;
        return Ok(());
    }

    crate::diagnostics::log(&format!("installing update {}", update.version));
    // On Windows the installer (passive mode, with its own progress window) takes over and the
    // app exits; elsewhere the app bundle is replaced and the app restarts.
    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|error| error.to_string())?;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dialog_answers_map_to_choices() {
        assert_eq!(choice_for(&MessageDialogResult::Yes), UpdateChoice::Install);
        assert_eq!(choice_for(&MessageDialogResult::No), UpdateChoice::Later);
        assert_eq!(choice_for(&MessageDialogResult::Cancel), UpdateChoice::Skip);
    }

    #[test]
    fn a_skipped_version_is_only_offered_when_asked() {
        assert!(!should_offer("0.2.0", "0.2.0", false));
        assert!(should_offer("0.2.0", "0.2.0", true));
        assert!(should_offer("0.3.0", "0.2.0", false));
        assert!(should_offer("0.2.0", "", false));
    }

    #[test]
    fn the_portable_build_offers_the_download_page() {
        let installed = offer_message("0.3.0", "0.2.0", "Notes", false);
        assert!(installed.starts_with("SuperMark 0.3.0 is available (you have 0.2.0).\n\nNotes\n\n"));
        assert!(installed.contains("download and install now"));
        let portable = offer_message("0.3.0", "0.2.0", "", true);
        assert!(portable.contains("cannot update itself"));
        assert!(portable.contains("open the download page"));
        assert!(!portable.contains("\n\n\n"));
    }

    #[test]
    fn long_release_notes_are_trimmed() {
        assert_eq!(notes_excerpt(None), "");
        assert_eq!(notes_excerpt(Some("  short  ")), "short");
        let long = "가".repeat(MAX_NOTES_CHARS + 50);
        let excerpt = notes_excerpt(Some(&long));
        assert_eq!(excerpt.chars().count(), MAX_NOTES_CHARS + 1);
        assert!(excerpt.ends_with('…'));
    }
}
