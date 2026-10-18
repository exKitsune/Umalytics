//! Transport-only wrapper. The Python bridge validates the explicit retail
//! profile before submitting a request; upstream defaults are never relied on.
fn main() {
    if let Err(error) = globalsim::run_worker() {
        eprintln!("globalsim worker error: {error}");
        std::process::exit(1);
    }
}
