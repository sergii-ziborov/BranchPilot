use std::collections::BTreeSet;
use std::path::Path;

use weavatrix_scan::{EvidenceMode, IgnorePolicy, ScanOptions, Scanner, StandardSkips};

use crate::error::Result;

/// Working-tree files Git reports as untracked with `--untracked-files=all`.
///
/// weavatrix-git's status is index-driven and deliberately excludes untracked
/// paths, so discovery runs through weavatrix-scan with Git's ignore sources —
/// and only those: no `.ignore` files, no built-in skip list, no hidden-file
/// filtering, so the result matches `git status`, not a scanner's opinion.
pub fn untracked_paths(root: &Path, tracked: &BTreeSet<String>) -> Result<Vec<String>> {
    let report = Scanner::new(root)
        .options(status_scan_options())
        .scan_compact()?;

    let mut paths = Vec::new();

    for file in report.files {
        let path = normalize_separators(&file.relative);

        if is_git_internal(&path) || tracked.contains(&path) {
            continue;
        }

        paths.push(path);
    }

    Ok(paths)
}

/// Scan configuration that reproduces Git's untracked-file semantics.
fn status_scan_options() -> ScanOptions {
    ScanOptions {
        // Status must see every file regardless of size or content type.
        max_file_bytes: u64::MAX,
        hash_file_contents: false,
        detect_binary_files: false,
        evidence: EvidenceMode::SelectedFiles,
        // Only Git's own ignore sources decide what is untracked.
        ignore_files: vec![".gitignore".to_owned()],
        ignore_policy: IgnorePolicy {
            parent_rules: false,
            git_ignore: true,
            dot_ignore: false,
            custom_ignore: false,
            git_exclude: true,
            git_global: true,
            require_git: false,
            explicit_files: Vec::new(),
        },
        skip_hidden: false,
        standard_skips: StandardSkips::Disabled,
        ..ScanOptions::default()
    }
}

fn is_git_internal(path: &str) -> bool {
    path == ".git" || path.starts_with(".git/")
}

/// Git records paths with forward slashes on every platform.
fn normalize_separators(path: &str) -> String {
    if path.contains('\\') {
        path.replace('\\', "/")
    } else {
        path.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::{is_git_internal, normalize_separators};

    #[test]
    fn skips_git_directory_only() {
        assert!(is_git_internal(".git"));
        assert!(is_git_internal(".git/config"));
        assert!(!is_git_internal(".gitignore"));
        assert!(!is_git_internal("src/.gitkeep"));
    }

    #[test]
    fn normalizes_windows_separators() {
        assert_eq!(normalize_separators("src\\app.ts"), "src/app.ts");
        assert_eq!(normalize_separators("src/app.ts"), "src/app.ts");
    }
}
