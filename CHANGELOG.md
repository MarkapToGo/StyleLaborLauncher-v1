# Changelog

All notable changes to this project will be documented in this file.

## [2026.1.5] - 2026-01-05

### Added
- **Log Analyzer**: Fully migrated the Log Analyzer automation to Rust for improved reliability and speed.
- **Log Analyzer**: Added robust input detection (`#file-fetch-url`) and speed optimizations (removed fixed delays).
- **UI**: Added close button to profile logs.

### Changed
- **UI**: Refactored Log Page buttons to use consistent `Button` component styling (`src/pages/ProfileLogs.tsx`).
- **UI**: Enhanced "Not Selected" states in the Log Page for better visual hierarchy.
- **UI**: Enhanced Mod search bar with clear button and better focus states (`src/pages/ProfileDetails.tsx`).

### Fixed
- Fixed issues with automated log uploading where buttons/inputs were not being found.
- Fixed script injection timing issues by moving to Rust `initialization_script`.
