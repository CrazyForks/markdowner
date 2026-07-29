use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use serde_json::Value;

/// Built-in Claude Code slash commands, invoked as `/name`.
const CLAUDE_CODE_BUILTIN_COMMANDS: &[&str] = &[
    "add-dir",
    "agents",
    "allowed-tools",
    "background",
    "bug",
    "checkpoint",
    "clear",
    "code-review",
    "compact",
    "config",
    "context",
    "continue",
    "cost",
    "debug",
    "doctor",
    "effort",
    "exit",
    "export",
    "fast",
    "feedback",
    "fork",
    "goal",
    "help",
    "hooks",
    "ide",
    "init",
    "insights",
    "install-github-app",
    "install-slack-app",
    "keybindings",
    "login",
    "logout",
    "loop",
    "mcp",
    "memory",
    "model",
    "permissions",
    "plan",
    "plugin",
    "pr-comments",
    "privacy-settings",
    "quit",
    "recap",
    "release-notes",
    "reload-plugins",
    "reload-skills",
    "rename",
    "resume",
    "review",
    "rewind",
    "run",
    "sandbox",
    "schedule",
    "security-review",
    "settings",
    "simplify",
    "skills",
    "stats",
    "status",
    "statusline",
    "stop",
    "tasks",
    "terminal-setup",
    "theme",
    "undo",
    "upgrade",
    "usage",
    "verify",
    "vim",
    "workflows",
];

/// Built-in Codex CLI slash commands, invoked as `/name`.
const CODEX_BUILTIN_COMMANDS: &[&str] = &[
    "approvals",
    "apps",
    "archive",
    "clear",
    "compact",
    "copy",
    "diff",
    "exit",
    "experimental",
    "feedback",
    "fork",
    "init",
    "keymap",
    "logout",
    "mcp",
    "mention",
    "model",
    "new",
    "permissions",
    "personality",
    "plan",
    "prompts",
    "ps",
    "quit",
    "rename",
    "resume",
    "review",
    "skills",
    "status",
    "statusline",
    "subagents",
    "theme",
    "title",
    "vim",
];

/// Accepts invocable names like `git-commit` or `superpowers:brainstorming`.
/// The charset mirrors the frontend token matcher; anything else on disk
/// (e.g. a dotted backup dir) could never be typed as a `/name` token anyway.
fn is_valid_skill_name(name: &str) -> bool {
    !name.is_empty()
        && name.split(':').all(|segment| {
            !segment.is_empty()
                && segment
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
        })
}

/// Collects `<root>/<name>/SKILL.md` skill names. Follows symlinks
/// (`~/.claude/skills` entries commonly link into `~/.agents/skills`).
fn collect_skill_dir_names(root: &Path, into: &mut BTreeSet<String>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        if !metadata.is_dir() || !path.join("SKILL.md").is_file() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if is_valid_skill_name(&name) {
            into.insert(name);
        }
    }
}

/// Collects `<root>/<stem>.md` command names (top level only — the layout
/// used by `~/.claude/commands` and `~/.codex/prompts`).
fn collect_command_file_stems(root: &Path, into: &mut BTreeSet<String>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        if !metadata.is_file() || path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) else {
            continue;
        };
        if is_valid_skill_name(stem) {
            into.insert(stem.to_string());
        }
    }
}

/// Collects skills and commands shipped by installed Claude Code plugins.
/// Reads `installed_plugins.json` (`"plugin@marketplace": [{ "installPath" }]`)
/// instead of globbing the plugin cache, which keeps stale version dirs out.
/// Each entry is registered both namespaced (`plugin:name`) and bare (`name`),
/// matching how Claude Code resolves unambiguous plugin skills.
fn collect_claude_plugin_names(claude_dir: &Path, into: &mut BTreeSet<String>) {
    let manifest_path = claude_dir.join("plugins").join("installed_plugins.json");
    let Ok(raw) = fs::read_to_string(&manifest_path) else {
        return;
    };
    let Ok(manifest) = serde_json::from_str::<Value>(&raw) else {
        return;
    };
    let Some(plugins) = manifest.get("plugins").and_then(Value::as_object) else {
        return;
    };
    for (plugin_id, installs) in plugins {
        let plugin_name = plugin_id.split('@').next().unwrap_or(plugin_id);
        if !is_valid_skill_name(plugin_name) {
            continue;
        }
        let Some(installs) = installs.as_array() else {
            continue;
        };
        for install in installs {
            let Some(install_path) = install.get("installPath").and_then(Value::as_str) else {
                continue;
            };
            let install_path = Path::new(install_path);
            let mut plugin_entries = BTreeSet::new();
            collect_skill_dir_names(&install_path.join("skills"), &mut plugin_entries);
            collect_command_file_stems(&install_path.join("commands"), &mut plugin_entries);
            for entry in plugin_entries {
                into.insert(format!("{plugin_name}:{entry}"));
                into.insert(entry);
            }
        }
    }
}

/// Scans every known Claude Code / Codex skill registry under `home`.
fn collect_installed_skill_names(home: &Path, into: &mut BTreeSet<String>) {
    let claude_dir = home.join(".claude");
    collect_skill_dir_names(&claude_dir.join("skills"), into);
    collect_command_file_stems(&claude_dir.join("commands"), into);
    collect_claude_plugin_names(&claude_dir, into);
    // Agent Skills open-standard dir shared by both tools.
    collect_skill_dir_names(&home.join(".agents").join("skills"), into);
    let codex_skills = home.join(".codex").join("skills");
    collect_skill_dir_names(&codex_skills, into);
    collect_skill_dir_names(&codex_skills.join(".system"), into);
    collect_command_file_stems(&home.join(".codex").join("prompts"), into);
}

fn build_skill_name_list(home: Option<&Path>) -> Vec<String> {
    let mut names: BTreeSet<String> = CLAUDE_CODE_BUILTIN_COMMANDS
        .iter()
        .chain(CODEX_BUILTIN_COMMANDS)
        .map(|name| (*name).to_string())
        .collect();
    if let Some(home) = home {
        collect_installed_skill_names(home, &mut names);
    }
    names.into_iter().collect()
}

/// Names invocable as `/name` or `$name` in Claude Code / Codex: built-in
/// commands plus the skills, commands, prompts, and plugin skills installed
/// on this machine. Missing registries are skipped, never an error.
#[tauri::command]
pub(crate) fn list_skill_names() -> Result<Vec<String>, String> {
    Ok(build_skill_name_list(
        crate::user_home_dir().ok().as_deref(),
    ))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use super::{build_skill_name_list, is_valid_skill_name};

    fn write_skill(root: &Path, name: &str) {
        let dir = root.join(name);
        fs::create_dir_all(&dir).expect("create skill dir");
        fs::write(dir.join("SKILL.md"), "---\nname: test\n---\n").expect("write SKILL.md");
    }

    #[test]
    fn missing_home_still_lists_builtin_commands() {
        let names = build_skill_name_list(None);
        assert!(names.iter().any(|name| name == "goal"));
        assert!(names.iter().any(|name| name == "compact"));
        assert!(names.windows(2).all(|pair| pair[0] < pair[1]), "sorted, deduped");
    }

    #[test]
    fn scans_skill_dirs_command_stems_and_prompts() {
        let home = tempfile::tempdir().expect("tempdir");
        write_skill(&home.path().join(".claude/skills"), "git-commit");
        write_skill(&home.path().join(".agents/skills"), "git-commit");
        write_skill(&home.path().join(".codex/skills"), "frontend-design");
        write_skill(&home.path().join(".codex/skills/.system"), "skill-creator");
        let commands = home.path().join(".claude/commands");
        fs::create_dir_all(&commands).expect("create commands dir");
        fs::write(commands.join("gcpr.md"), "checkpoint commits").expect("write command");
        fs::write(commands.join("notes.txt"), "not a command").expect("write non-md");
        let prompts = home.path().join(".codex/prompts");
        fs::create_dir_all(&prompts).expect("create prompts dir");
        fs::write(prompts.join("triage.md"), "prompt").expect("write prompt");

        let names = build_skill_name_list(Some(home.path()));

        for expected in ["git-commit", "frontend-design", "skill-creator", "gcpr", "triage"] {
            assert!(names.iter().any(|name| name == expected), "missing {expected}");
        }
        assert!(!names.iter().any(|name| name == "notes"));
        assert_eq!(
            names.iter().filter(|name| *name == "git-commit").count(),
            1,
            "same skill in two registries stays deduped"
        );
    }

    #[test]
    fn skill_dirs_without_skill_md_are_ignored() {
        let home = tempfile::tempdir().expect("tempdir");
        let empty = home.path().join(".claude/skills/not-a-skill");
        fs::create_dir_all(&empty).expect("create empty dir");

        let names = build_skill_name_list(Some(home.path()));

        assert!(!names.iter().any(|name| name == "not-a-skill"));
    }

    #[test]
    fn plugin_manifest_registers_namespaced_and_bare_names() {
        let home = tempfile::tempdir().expect("tempdir");
        let install = home.path().join("cache/superpowers/1.0.0");
        write_skill(&install.join("skills"), "brainstorming");
        let plugin_commands = install.join("commands");
        fs::create_dir_all(&plugin_commands).expect("create plugin commands");
        fs::write(plugin_commands.join("ralph-loop.md"), "loop").expect("write plugin command");
        let plugins_dir = home.path().join(".claude/plugins");
        fs::create_dir_all(&plugins_dir).expect("create plugins dir");
        let manifest = serde_json::json!({
            "version": 2,
            "plugins": {
                "superpowers@obra": [{ "installPath": install.to_string_lossy() }]
            }
        });
        fs::write(
            plugins_dir.join("installed_plugins.json"),
            serde_json::to_string(&manifest).expect("serialize manifest"),
        )
        .expect("write manifest");

        let names = build_skill_name_list(Some(home.path()));

        for expected in [
            "superpowers:brainstorming",
            "brainstorming",
            "superpowers:ralph-loop",
            "ralph-loop",
        ] {
            assert!(names.iter().any(|name| name == expected), "missing {expected}");
        }
    }

    #[test]
    fn invalid_names_are_rejected() {
        assert!(is_valid_skill_name("git-commit"));
        assert!(is_valid_skill_name("superpowers:brainstorming"));
        assert!(is_valid_skill_name("ce_commit2"));
        assert!(!is_valid_skill_name(""));
        assert!(!is_valid_skill_name("has space"));
        assert!(!is_valid_skill_name("trailing:"));
        assert!(!is_valid_skill_name("dot.name"));
    }
}
