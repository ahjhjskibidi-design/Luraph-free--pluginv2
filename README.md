# Lua Obf

> A Lua obfuscator for Roblox scripts. Multi-layer transformation, VM-based output, anti-tamper.

Most Roblox scripts are easy to read. Anyone with a Lua decompiler can recover your logic in seconds. Lua Obf exists to make that hard.

## What It Does

Given a Lua script, Lua Obf:

- Renames every identifier (locals, functions, parameters, labels)
- Encrypts every string literal (XOR + char arrays)
- Obfuscates every number (hex, arithmetic, lookup tables)
- Injects dead branches that never execute
- Flattens control flow into a state machine
- Wraps the result in a VM bytecode layer
- Adds anti-tamper checks against debuggers

The output runs identically in Roblox. The source is unreadable.

## What It Does Not Do

- It does not make code unbreakable. Every obfuscator can be reversed given time.
- It does not hide secrets. An API key in a client script is exposed.
- It does not bypass Roblox moderation.
- It does not replace Luraph.

## Presets

Three levels:

- **Light** — rename identifiers, minify. Fast, small. Reversible in minutes.
- **Medium** — plus string and number encoding, dead code. 2-3x size.
- **Heavy** — plus control-flow flattening, VM wrapping, anti-tamper. 5-15x size.

## Install

### Clone and run locally

    git clone https://github.com/YOUR_USERNAME/lua-obf
    cd lua-obf
    npm install
    npm start

Open `http://localhost:3000`.

### Run in Codespaces

Open this repo in Codespaces. Codespaces forwards the port automatically.

### Deploy to Railway

    bash scripts/deploy.sh

## Usage

**Web interface:**

1. Paste your Lua script into the left panel
2. Choose a preset
3. Click "Obfuscate"
4. Copy the result

**API:**

    curl -X POST http://localhost:3000/api/obfuscate \
      -H "Content-Type: application/json" \
      -d '{"code": "print(\"hello\")", "preset": "medium"}'

## Project Structure

- `public/` — frontend
- `src/` — backend (Express)
- `engine/` — obfuscator core
- `docs/` — references
- `scripts/` — deploy

## Documentation

- `docs/techniques.md` — obfuscation techniques explained
- `docs/presets.md` — what each preset does and costs
- `docs/deobfuscators.md` — tools that reverse obfuscation
- `docs/limitations.md` — what this cannot do
- `docs/examples.md` — before and after

## License

MIT. See LICENSE.