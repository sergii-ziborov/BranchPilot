use std::path::Path;

/// How Git converts a path between the worktree and stored content.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Conversion {
    /// Stored bytes are the worktree bytes.
    Raw,
    /// Stored bytes drop the CR of every CRLF pair.
    CrlfToLf,
    /// A clean filter (Git LFS, or any custom `filter=`) rewrites the content,
    /// and only that filter knows how.
    Filtered,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TextRule {
    Unspecified,
    /// `text` or `text=auto`
    Text,
    /// `-text` or `binary`
    Binary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EolRule {
    Unspecified,
    Lf,
    Crlf,
}

#[derive(Debug, Clone, Copy)]
struct PathRules {
    text: TextRule,
    eol: EolRule,
    filtered: bool,
}

impl PathRules {
    const fn unspecified() -> Self {
        Self {
            text: TextRule::Unspecified,
            eol: EolRule::Unspecified,
            filtered: false,
        }
    }
}

#[derive(Debug)]
struct Rule {
    pattern: Pattern,
    rules: PathRules,
}

/// The repository's top-level `.gitattributes`.
///
/// Per-directory attribute files are reported by [`Attributes::nested`] rather
/// than half-applied: a rule this reader cannot see must never be guessed at.
#[derive(Debug, Default)]
pub struct Attributes {
    rules: Vec<Rule>,
    nested: bool,
}

impl Attributes {
    #[must_use]
    pub fn load(work_dir: &Path) -> Self {
        let Ok(text) = std::fs::read_to_string(work_dir.join(".gitattributes")) else {
            return Self::default();
        };

        Self {
            rules: parse(&text),
            nested: false,
        }
    }

    /// Record that tracked per-directory attribute files exist.
    pub fn set_nested(&mut self, nested: bool) {
        self.nested = nested;
    }

    #[must_use]
    pub const fn nested(&self) -> bool {
        self.nested
    }

    /// Resolve the conversion for one path. `autocrlf` is the fallback when no
    /// attribute decides, matching Git's precedence.
    #[must_use]
    pub fn conversion(&self, path: &str, autocrlf_normalizes: bool) -> Conversion {
        let mut resolved = PathRules::unspecified();

        // Git applies rules in file order, with later matches winning.
        for rule in &self.rules {
            if !rule.pattern.matches(path) {
                continue;
            }

            if rule.rules.text != TextRule::Unspecified {
                resolved.text = rule.rules.text;
            }
            if rule.rules.eol != EolRule::Unspecified {
                resolved.eol = rule.rules.eol;
            }
            resolved.filtered = resolved.filtered || rule.rules.filtered;
        }

        if resolved.filtered {
            return Conversion::Filtered;
        }

        match (resolved.text, resolved.eol) {
            (TextRule::Binary, _) => Conversion::Raw,
            // An explicit checkout ending decides what the worktree holds.
            (_, EolRule::Lf) => Conversion::Raw,
            (_, EolRule::Crlf) | (TextRule::Text, EolRule::Unspecified) => Conversion::CrlfToLf,
            (TextRule::Unspecified, EolRule::Unspecified) => {
                if autocrlf_normalizes {
                    Conversion::CrlfToLf
                } else {
                    Conversion::Raw
                }
            }
        }
    }
}

fn parse(text: &str) -> Vec<Rule> {
    let mut rules = Vec::new();

    for line in text.lines() {
        let line = line.trim();

        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let mut parts = line.split_whitespace();
        let Some(pattern) = parts.next() else {
            continue;
        };

        let mut path_rules = PathRules::unspecified();

        for token in parts {
            match token {
                "text" | "text=auto" => path_rules.text = TextRule::Text,
                "-text" | "binary" => path_rules.text = TextRule::Binary,
                "eol=lf" => path_rules.eol = EolRule::Lf,
                "eol=crlf" => path_rules.eol = EolRule::Crlf,
                _ if token.starts_with("filter=") => path_rules.filtered = true,
                _ => {}
            }
        }

        // `binary` is shorthand for `-text -diff`; the text half is what matters
        // for content comparison.
        rules.push(Rule {
            pattern: Pattern::parse(pattern),
            rules: path_rules,
        });
    }

    rules
}

/// The gitignore-style pattern subset `.gitattributes` uses.
#[derive(Debug)]
struct Pattern {
    /// Matched against the basename only when the pattern has no slash.
    basename_only: bool,
    segments: Vec<String>,
}

impl Pattern {
    fn parse(pattern: &str) -> Self {
        let trimmed = pattern.trim_start_matches('/');

        Self {
            basename_only: !trimmed.contains('/'),
            segments: trimmed.split('/').map(str::to_owned).collect(),
        }
    }

    fn matches(&self, path: &str) -> bool {
        if self.basename_only {
            let name = path.rsplit('/').next().unwrap_or(path);
            return glob_matches(&self.segments[0], name);
        }

        let path_segments: Vec<&str> = path.split('/').collect();

        matches_segments(&self.segments, &path_segments)
    }
}

fn matches_segments(pattern: &[String], path: &[&str]) -> bool {
    match pattern.first() {
        None => path.is_empty(),
        Some(segment) if segment == "**" => (0..=path.len())
            .any(|skip| matches_segments(&pattern[1..], &path[skip..])),
        Some(segment) => {
            let Some(head) = path.first() else {
                return false;
            };

            glob_matches(segment, head) && matches_segments(&pattern[1..], &path[1..])
        }
    }
}

/// `*` and `?` within one path segment; `[…]` classes are not used by the
/// attribute files this reader supports and fall through as literals.
fn glob_matches(pattern: &str, value: &str) -> bool {
    let pattern: Vec<char> = pattern.chars().collect();
    let value: Vec<char> = value.chars().collect();
    let mut table = vec![vec![false; value.len() + 1]; pattern.len() + 1];
    table[0][0] = true;

    for (index, character) in pattern.iter().enumerate() {
        if *character == '*' {
            table[index + 1][0] = table[index][0];
        }
    }

    for (row, character) in pattern.iter().enumerate() {
        for column in 0..value.len() {
            table[row + 1][column + 1] = match character {
                '*' => table[row][column + 1] || table[row + 1][column],
                '?' => table[row][column],
                _ => table[row][column] && *character == value[column],
            };
        }
    }

    table[pattern.len()][value.len()]
}

#[cfg(test)]
mod tests {
    use super::{Attributes, Conversion, Pattern, glob_matches, parse};

    fn attributes(text: &str) -> Attributes {
        Attributes {
            rules: parse(text),
            nested: false,
        }
    }

    #[test]
    fn matches_extension_patterns_anywhere() {
        assert!(Pattern::parse("*.png").matches("docs/img/logo.png"));
        assert!(!Pattern::parse("*.png").matches("docs/logo.svg"));
        assert!(Pattern::parse("src/*.ts").matches("src/app.ts"));
        assert!(!Pattern::parse("src/*.ts").matches("src/deep/app.ts"));
        assert!(Pattern::parse("src/**/*.ts").matches("src/deep/app.ts"));
    }

    #[test]
    fn glob_handles_wildcards() {
        assert!(glob_matches("*", "anything"));
        assert!(glob_matches("*.rs", "lib.rs"));
        assert!(glob_matches("a?c", "abc"));
        assert!(!glob_matches("a?c", "ac"));
    }

    #[test]
    fn checkout_eol_decides_over_autocrlf() {
        let resolved = attributes("* text=auto eol=lf\n");

        assert_eq!(resolved.conversion("src/app.ts", true), Conversion::Raw);
    }

    #[test]
    fn binary_paths_are_never_converted() {
        let resolved = attributes("* text=auto\n*.png binary\n");

        assert_eq!(resolved.conversion("logo.png", true), Conversion::Raw);
        assert_eq!(resolved.conversion("app.ts", true), Conversion::CrlfToLf);
    }

    #[test]
    fn clean_filters_are_reported() {
        let resolved = attributes("*.psd filter=lfs diff=lfs merge=lfs -text\n");

        assert_eq!(resolved.conversion("art/cover.psd", false), Conversion::Filtered);
    }

    #[test]
    fn falls_back_to_autocrlf_without_rules() {
        let resolved = attributes("");

        assert_eq!(resolved.conversion("app.ts", true), Conversion::CrlfToLf);
        assert_eq!(resolved.conversion("app.ts", false), Conversion::Raw);
    }
}
