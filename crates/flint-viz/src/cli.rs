use std::net::{IpAddr, Ipv4Addr};
use std::path::PathBuf;

use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(name = "flint-viz", version, about = "Flint test visualizer")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Serve the visualizer on a local HTTP port.
    Serve {
        /// Directory to scan for Flint test JSON files. If omitted, the
        /// server starts in read-only mode (failure-URL viewer only).
        path: Option<PathBuf>,

        /// IP address to bind on. Use `0.0.0.0` to accept connections from
        /// outside the host (e.g. when running inside Docker).
        #[arg(long, default_value_t = IpAddr::V4(Ipv4Addr::LOCALHOST))]
        host: IpAddr,

        /// Port to bind on.
        #[arg(short, long, default_value_t = 7878)]
        port: u16,

        /// Open the visualizer URL in the system browser after the server starts.
        #[arg(long)]
        open: bool,
    },
}
