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
        Some(other) => Err(format!("unknown task `{other}`. Try: build")),
        None => Err("no task given. Try: cargo xtask build [--debug]".into()),
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
    let workspace = workspace_root()?;
    let frontend = workspace.join("frontend");

    ensure_npm()?;

    println!("xtask: npm ci  ({})", frontend.display());
    run("npm", &["ci"], &frontend)?;

    println!("xtask: npm run build  ({})", frontend.display());
    run("npm", &["run", "build"], &frontend)?;

    let mut cargo_args: Vec<&str> =
        vec!["build", "-p", "flint-viz", "--features", "embed-frontend"];
    if !debug {
        cargo_args.push("--release");
    }
    println!("xtask: cargo {}", cargo_args.join(" "));
    run("cargo", &cargo_args, &workspace)?;

    let profile = if debug { "debug" } else { "release" };
    println!("xtask: built target/{profile}/flint-viz (with embedded frontend)");
    Ok(())
}

fn ensure_npm() -> Result<(), String> {
    Command::new("npm")
        .arg("--version")
        .output()
        .map_err(|err| format!("npm not found on PATH: {err}"))?;
    Ok(())
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
