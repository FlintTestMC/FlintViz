//! Workspace tasks. Run via `cargo xtask <command>`.

use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

const DEFAULT_LINUX_TARGET: &str = "x86_64-unknown-linux-gnu";
const DEFAULT_WINDOWS_TARGET: &str = "x86_64-pc-windows-gnu";

fn main() -> ExitCode {
    let mut args = env::args().skip(1);
    let cmd = args.next();
    let rest: Vec<String> = args.collect();

    let result = match cmd.as_deref() {
        Some("build") => build(&rest),
        Some("deb") => deb(&rest),
        Some(other) => Err(format!(
            "unknown task `{other}`. Try: build [linux|windows] [--debug] [--target <triple>], deb [--target <triple>]"
        )),
        None => Err(
            "no task given. Try: cargo xtask build [linux|windows] [--debug] [--target <triple>]  |  cargo xtask deb [--target <triple>]".into()
        ),
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("xtask: {err}");
            ExitCode::FAILURE
        }
    }
}

fn build(args: &[String]) -> Result<(), String> {
    let config = parse_build_config(args)?;
    build_project(config.debug, config.target)
}

fn build_project(debug: bool, target: Option<String>) -> Result<(), String> {
    let workspace = workspace_root()?;
    let frontend = workspace.join("frontend");

    ensure_npm()?;

    println!("xtask: npm ci  ({})", frontend.display());
    run(npm_cmd(), &["ci"], &frontend)?;

    println!("xtask: npm run assets  ({})", frontend.display());
    run(npm_cmd(), &["run", "assets"], &frontend)?;

    println!("xtask: npm run build  ({})", frontend.display());
    run(npm_cmd(), &["run", "build"], &frontend)?;

    let mut cargo_args: Vec<&str> =
        vec!["build", "-p", "flint-viz", "--features", "embed-frontend"];
    if !debug {
        cargo_args.push("--release");
    }
    if let Some(t) = target.as_deref() {
        cargo_args.push("--target");
        cargo_args.push(t);
    }
    println!("xtask: cargo {}", cargo_args.join(" "));
    run("cargo", &cargo_args, &workspace)?;

    let profile = if debug { "debug" } else { "release" };
    let out = binary_path(target.as_deref(), profile);
    println!("xtask: built {out} (with embedded frontend)");
    Ok(())
}

fn deb(args: &[String]) -> Result<(), String> {
    if args.iter().any(|a| a == "--debug") {
        return Err("cargo xtask deb requires a release build; remove --debug".into());
    }
    ensure_cargo_deb()?;

    let workspace = workspace_root()?;
    let target = parse_target(args)?;
    build_project(false, target.clone())?;

    let mut deb_args: Vec<&str> = vec!["deb", "-p", "flint-viz", "--no-build", "--no-strip"];
    if let Some(t) = target.as_deref() {
        deb_args.push("--target");
        deb_args.push(t);
    }
    println!("xtask: cargo {}", deb_args.join(" "));
    run("cargo", &deb_args, &workspace)?;

    let out_dir = match target.as_deref() {
        Some(t) => format!("target/{t}/debian/"),
        None => "target/debian/".into(),
    };
    println!("xtask: .deb written to {out_dir}");
    Ok(())
}

#[derive(Debug)]
struct BuildConfig {
    debug: bool,
    target: Option<String>,
}

fn parse_build_config(args: &[String]) -> Result<BuildConfig, String> {
    let debug = args.iter().any(|a| a == "--debug");
    let target_override = parse_target(args)?;
    let os = parse_build_os(args)?;
    let default_target = match os {
        BuildOs::Linux => DEFAULT_LINUX_TARGET,
        BuildOs::Windows => DEFAULT_WINDOWS_TARGET,
    };

    Ok(BuildConfig {
        debug,
        target: Some(target_override.unwrap_or_else(|| default_target.to_string())),
    })
}

enum BuildOs {
    Linux,
    Windows,
}

fn parse_build_os(args: &[String]) -> Result<BuildOs, String> {
    let mut os = None;
    let mut iter = args.iter();

    while let Some(arg) = iter.next() {
        if arg == "--target" {
            iter.next();
            continue;
        }
        if arg.starts_with("--") {
            continue;
        }

        let parsed = match arg.as_str() {
            "linux" => BuildOs::Linux,
            "windows" => BuildOs::Windows,
            other => {
                return Err(format!(
                    "unknown build OS `{other}`. Try: cargo xtask build [linux|windows] [--debug] [--target <triple>]"
                ));
            }
        };

        if os.replace(parsed).is_some() {
            return Err(
                "only one build OS may be specified. Try: cargo xtask build [linux|windows]".into(),
            );
        }
    }

    Ok(os.unwrap_or(BuildOs::Linux))
}

fn parse_target(args: &[String]) -> Result<Option<String>, String> {
    let mut iter = args.iter();
    while let Some(a) = iter.next() {
        if a == "--target" {
            return iter
                .next()
                .cloned()
                .map(Some)
                .ok_or_else(|| "--target requires a triple argument".into());
        }
        if let Some(rest) = a.strip_prefix("--target=") {
            return Ok(Some(rest.to_string()));
        }
    }
    Ok(None)
}

fn binary_path(target: Option<&str>, profile: &str) -> String {
    let name = match target {
        Some(t) if is_windows_target(t) => "flint-viz.exe",
        _ => "flint-viz",
    };

    match target {
        Some(t) => format!("target/{t}/{profile}/{name}"),
        None => format!("target/{profile}/{name}"),
    }
}

fn is_windows_target(target: &str) -> bool {
    target.contains("windows")
}

fn ensure_npm() -> Result<(), String> {
    Command::new(npm_cmd())
        .arg("--version")
        .output()
        .map_err(|err| format!("npm not found on PATH: {err}"))?;
    Ok(())
}

fn ensure_cargo_deb() -> Result<(), String> {
    let ok = Command::new("cargo")
        .args(["deb", "--version"])
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false);
    if !ok {
        return Err(
            "cargo-deb not installed. Install with: cargo install cargo-deb --locked".into(),
        );
    }
    Ok(())
}

fn npm_cmd() -> &'static str {
    if cfg!(windows) { "npm.cmd" } else { "npm" }
}

fn run(cmd: &str, args: &[&str], cwd: &Path) -> Result<(), String> {
    let status = Command::new(cmd)
        .args(args)
        .current_dir(cwd)
        .status()
        .map_err(|err| format!("failed to spawn `{cmd}`: {err}"))?;
    if !status.success() {
        return Err(format!("`{cmd} {}` exited with {status}", args.join(" ")));
    }
    Ok(())
}

fn workspace_root() -> Result<PathBuf, String> {
    let manifest = env!("CARGO_MANIFEST_DIR");
    Path::new(manifest)
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| format!("cannot derive workspace root from {manifest}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn build_defaults_to_linux_target() {
        let config = parse_build_config(&args(&[])).unwrap();

        assert!(!config.debug);
        assert_eq!(config.target.as_deref(), Some(DEFAULT_LINUX_TARGET));
    }

    #[test]
    fn build_accepts_explicit_windows_target() {
        let config = parse_build_config(&args(&["windows", "--debug"])).unwrap();

        assert!(config.debug);
        assert_eq!(config.target.as_deref(), Some(DEFAULT_WINDOWS_TARGET));
    }

    #[test]
    fn target_override_wins_over_os_default() {
        let config =
            parse_build_config(&args(&["windows", "--target", "x86_64-pc-windows-msvc"])).unwrap();

        assert_eq!(config.target.as_deref(), Some("x86_64-pc-windows-msvc"));
    }

    #[test]
    fn rejects_unknown_build_os() {
        let err = parse_build_config(&args(&["macos"])).unwrap_err();

        assert!(err.contains("unknown build OS `macos`"));
    }

    #[test]
    fn binary_path_uses_exe_for_windows_targets() {
        assert_eq!(
            binary_path(Some("x86_64-pc-windows-gnu"), "release"),
            "target/x86_64-pc-windows-gnu/release/flint-viz.exe"
        );
        assert_eq!(
            binary_path(Some("x86_64-unknown-linux-gnu"), "debug"),
            "target/x86_64-unknown-linux-gnu/debug/flint-viz"
        );
    }
}
