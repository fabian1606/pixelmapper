//! Native application menu (macOS menu bar, window menu elsewhere).
//!
//! The menu only names actions: every custom item emits its id as an
//! `app-menu` event and the frontend (`app/composables/app-menu`) runs the
//! matching app command. Item ids MUST match `APP_COMMANDS` there.
//! Edit items are predefined (native selectors) so text fields keep
//! copy/paste; the canvas handles ⌘Z/⌘C/… itself via `keydown`.

use std::sync::Mutex;

use serde::Deserialize;
use tauri::menu::{IsMenuItem, Menu, MenuItem, MenuItemBuilder, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, State, Wry};

// ── Ids ──────────────────────────────────────────────

/// Event the frontend listens to; payload = item id.
pub const MENU_EVENT: &str = "app-menu";
/// Prefix of the dynamic "Open Recent" entries (`recent:<project id>`).
const RECENT_PREFIX: &str = "recent:";
/// "Open Recent" → "Clear Menu".
const RECENT_CLEAR: &str = "recent.clear";

// ── State ────────────────────────────────────────────

/// Menu parts that change at runtime.
pub struct AppMenu {
    /// The "Open Recent" submenu (rebuilt from the frontend's list).
    recent: Submenu<Wry>,
    /// Items that need an open project (Save, Export, Design/Live/Connections).
    project_items: Vec<MenuItem<Wry>>,
    /// Serializes rebuilds of the recent submenu.
    lock: Mutex<()>,
}

/// One "Open Recent" entry, sent by the frontend.
#[derive(Debug, Clone, Deserialize)]
pub struct RecentProject {
    pub id: String,
    pub name: String,
}

// ── Building ─────────────────────────────────────────

/// Shorthand for a custom item with an id, label and optional shortcut.
fn item(app: &AppHandle, id: &str, label: &str, accelerator: Option<&str>) -> tauri::Result<MenuItem<Wry>> {
    let mut b = MenuItemBuilder::with_id(id, label);
    if let Some(a) = accelerator {
        b = b.accelerator(a);
    }
    b.build(app)
}

/// Builds the menu, installs it and forwards clicks to the frontend.
pub fn install(app: &AppHandle) -> tauri::Result<AppMenu> {
    let new_project = item(app, "file.new", "New Project…", Some("CmdOrCtrl+N"))?;
    let open = item(app, "file.open", "Open…", Some("CmdOrCtrl+O"))?;
    let save = item(app, "file.save", "Save", Some("CmdOrCtrl+S"))?;
    let export = item(app, "file.export", "Export…", Some("CmdOrCtrl+Shift+E"))?;
    let projects = item(app, "view.projects", "All Projects", Some("CmdOrCtrl+Shift+H"))?;
    let design = item(app, "view.design", "Design", Some("CmdOrCtrl+1"))?;
    let live = item(app, "view.live", "Live", Some("CmdOrCtrl+2"))?;
    let connections = item(app, "view.connections", "Connections", Some("CmdOrCtrl+3"))?;

    let recent = SubmenuBuilder::with_id(app, "file.recent", "Open Recent").build()?;
    fill_recent(app, &recent, &[])?;

    let app_menu = SubmenuBuilder::new(app, "Pixelmapper")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&new_project)
        .item(&open)
        .item(&recent)
        .separator()
        .item(&save)
        .item(&export)
        .separator()
        .close_window()
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&projects)
        .separator()
        .item(&design)
        .item(&live)
        .item(&connections)
        .separator()
        .fullscreen()
        .build()?;
    let window = SubmenuBuilder::new(app, "Window").minimize().maximize().build()?;

    let mut builder = tauri::menu::MenuBuilder::new(app);
    // macOS shows the first submenu as the app menu; elsewhere it is not expected.
    if cfg!(target_os = "macos") {
        builder = builder.item(&app_menu);
    }
    let menu: Menu<Wry> = builder.items(&[&file, &edit, &view, &window]).build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        // Predefined items (copy, quit, …) are handled natively and never get here
        // with one of our ids; forwarding them anyway is harmless.
        let _ = app.emit(MENU_EVENT, event.id().as_ref());
    });

    let project_items = vec![save, export, design, live, connections];
    for i in &project_items {
        i.set_enabled(false)?;
    }
    Ok(AppMenu { recent, project_items, lock: Mutex::new(()) })
}

/// Replaces the entries of the "Open Recent" submenu.
fn fill_recent(app: &AppHandle, recent: &Submenu<Wry>, projects: &[RecentProject]) -> tauri::Result<()> {
    for old in recent.items()? {
        recent.remove(&old as &dyn IsMenuItem<Wry>)?;
    }
    for p in projects {
        recent.append(&item(app, &recent_id(&p.id), &p.name, None)?)?;
    }
    if !projects.is_empty() {
        recent.append(&tauri::menu::PredefinedMenuItem::separator(app)?)?;
    }
    let clear = MenuItemBuilder::with_id(RECENT_CLEAR, "Clear Menu").enabled(!projects.is_empty()).build(app)?;
    recent.append(&clear)?;
    Ok(())
}

/// Menu id of a recent project entry.
fn recent_id(project_id: &str) -> String {
    format!("{RECENT_PREFIX}{project_id}")
}

// ── Commands ─────────────────────────────────────────

/// Rebuilds "Open Recent" from the frontend's list (most recent first).
#[tauri::command]
pub fn menu_set_recent(app: AppHandle, menu: State<'_, AppMenu>, projects: Vec<RecentProject>) -> Result<(), String> {
    let _guard = menu.lock.lock().map_err(|e| e.to_string())?;
    fill_recent(&app, &menu.recent, &projects).map_err(|e| e.to_string())
}

/// Enables the items that only make sense inside a project.
#[tauri::command]
pub fn menu_set_project_open(menu: State<'_, AppMenu>, open: bool) -> Result<(), String> {
    for i in &menu.project_items {
        i.set_enabled(open).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Builds the menu during app setup and stores its handles.
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let menu = install(app)?;
    app.manage(menu);
    Ok(())
}

// ── Tests ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_ids_carry_the_project_id() {
        assert_eq!(recent_id("abc-123"), "recent:abc-123");
    }
}
