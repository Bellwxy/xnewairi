# Repository Workflows

## Scope

This directory contains GitHub Actions workflows. These workflows do not control local application startup.

CI, application builds, tests, and locale checks remain available.

## Removed Services

This repository does not run these upstream maintenance workflows:

- Crowdin source, translation, and glossary synchronization
- Cloudflare production, preview, and development deployments
- Automatic Nix dependency and asset hash updates
- Sponsor image updates

The remaining routine checks need no Crowdin, Cloudflare, Nix hash-update, or SponsorKit credentials.
Translation files, application code, local build commands, and Nix build files remain unchanged.
The server-dev workflow no longer starts a Cloudflare frontend deployment.

## Application Releases

The Android and Tamagotchi release workflows no longer run on a daily schedule.
Their manual and prerelease triggers remain in the source files.
Release signing and external publishing still require their own credentials.

Use CI for routine code checks. Do not use a release workflow as a substitute for CI.
Do not enable external publishing without configuring your own destination and credentials.
