use std::collections::BTreeMap;
use std::path::Path;

/// Minimal reader for Git's INI-style config.
///
/// Only what the native reads need: section/subsection/key lookup with Git's
/// casing rules (section and key case-insensitive, subsection case-sensitive).
/// Includes (`[include] path = …`) are intentionally not followed — a value the
/// reader cannot see is reported as absent, never guessed.
#[derive(Debug, Default)]
pub struct GitConfig {
    values: BTreeMap<String, String>,
}

impl GitConfig {
    /// Read a config file. A missing file is an empty config, not an error.
    #[must_use]
    pub fn load(path: &Path) -> Self {
        let Ok(text) = std::fs::read_to_string(path) else {
            return Self::default();
        };
        Self::parse(&text)
    }

    #[must_use]
    pub fn parse(text: &str) -> Self {
        let mut values = BTreeMap::new();
        let mut section = String::new();

        for raw_line in text.lines() {
            let line = strip_comment(raw_line.trim());
            if line.is_empty() {
                continue;
            }

            if let Some(header) = line.strip_prefix('[') {
                if let Some(header) = header.strip_suffix(']') {
                    section = parse_section(header);
                }
                continue;
            }

            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            if section.is_empty() {
                continue;
            }

            let key = key.trim().to_ascii_lowercase();
            values.insert(format!("{section}.{key}"), unquote(value.trim()));
        }

        Self { values }
    }

    /// Look up `section.subsection.key` (subsection optional).
    #[must_use]
    pub fn get(&self, key: &str) -> Option<&str> {
        self.values.get(key).map(String::as_str)
    }

    /// Short upstream name for a local branch, e.g. `origin/main`.
    ///
    /// Mirrors what `git status --porcelain=v2 --branch` reports for
    /// `branch.upstream`: the remote-tracking branch's short name, or the plain
    /// branch name when the branch tracks this same repository (`remote = .`).
    #[must_use]
    pub fn upstream(&self, branch: &str) -> Option<String> {
        if branch.is_empty() {
            return None;
        }

        let remote = self.get(&format!("branch.{branch}.remote"))?;
        let merge = self.get(&format!("branch.{branch}.merge"))?;
        let merge_short = merge.strip_prefix("refs/heads/").unwrap_or(merge);

        if remote == "." {
            return Some(merge_short.to_owned());
        }

        Some(format!("{remote}/{merge_short}"))
    }
}

/// `[branch "feature/x"]` → `branch.feature/x`; `[core]` → `core`.
fn parse_section(header: &str) -> String {
    let header = header.trim();

    match header.split_once(char::is_whitespace) {
        Some((name, subsection)) => {
            let subsection = subsection.trim().trim_matches('"').replace("\\\\", "\\");
            format!("{}.{}", name.trim().to_ascii_lowercase(), subsection)
        }
        None => header.to_ascii_lowercase(),
    }
}

/// Drop trailing `#`/`;` comments that are not inside quotes.
fn strip_comment(line: &str) -> &str {
    let mut quoted = false;

    for (index, character) in line.char_indices() {
        match character {
            '"' => quoted = !quoted,
            '#' | ';' if !quoted => return line[..index].trim_end(),
            _ => {}
        }
    }

    line
}

fn unquote(value: &str) -> String {
    value.trim().trim_matches('"').to_owned()
}

#[cfg(test)]
mod tests {
    use super::GitConfig;

    #[test]
    fn reads_branch_upstream() {
        let config = GitConfig::parse(
            "[core]\n\tbare = false\n[branch \"main\"]\n\tremote = origin\n\tmerge = refs/heads/main\n",
        );

        assert_eq!(config.upstream("main").as_deref(), Some("origin/main"));
        assert_eq!(config.get("core.bare"), Some("false"));
    }

    #[test]
    fn reads_local_tracking_branch() {
        let config =
            GitConfig::parse("[branch \"topic\"]\nremote = .\nmerge = refs/heads/develop\n");

        assert_eq!(config.upstream("topic").as_deref(), Some("develop"));
    }

    #[test]
    fn ignores_comments_and_unknown_branches() {
        let config = GitConfig::parse("# comment\n[branch \"main\"]\nremote = origin ; inline\n");

        assert_eq!(config.upstream("main"), None);
        assert_eq!(config.get("branch.main.remote"), Some("origin"));
    }
}
