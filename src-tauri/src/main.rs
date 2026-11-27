#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if !cfg!(feature = "facai-only") && std::env::args().any(|a| a == "--mcp") {
        kuro_cat_pet_lib::run_mcp_stdio();
        return;
    }
    kuro_cat_pet_lib::run();
}
