//! Workspace tasks. Run via `cargo xtask <command>`.

use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

fn main() -> ExitCode {
    let mut args = env::args().skip(1);
    let cmd = args.next();
    let rest: Vec<String> = args.collect();

    let result = match cmd.as_deref() {
        Some("build") => build(&rest),
        Some("deb") => deb(&rest),
        Some(other) => Err(format!(
            "unknown task `{other}`. Try: build [--debug] [--target <triple>], deb [--target <triple>]"
        )),
        None => Err(
            "no task given. Try: cargo xtask build [--debug] [--target <triple>]  |  cargo xtask deb [--target <triple>]".into()
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
    let debug = args.iter().any(|a| a == "--debug");
    let target = parse_target(args)?;
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
    let out = match target.as_deref() {
        Some(t) => format!("target/{t}/{profile}/flint-viz"),
        None => format!("target/{profile}/flint-viz"),
    };
    println!("xtask: built {out} (with embedded frontend)");
    Ok(())
}

fn deb(args: &[String]) -> Result<(), String> {
    if args.iter().any(|a| a == "--debug") {
        return Err("cargo xtask deb requires a release build; remove --debug".into());
    }
    ensure_cargo_deb()?;
    build(args)?;

    let workspace = workspace_root()?;
    let target = parse_target(args)?;

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
