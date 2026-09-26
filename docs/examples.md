# Examples

Before and after. What each preset actually produces.

## Input

    local function greet(name)
      return "Hello, " .. name
    end
    local message = greet("Roblox")
    print(message)

## Light Preset Output

    local function _0xa3f(_0xb1c)
      return "Hello, " .. _0xb1c
    end
    local _0xd2e = _0xa3f("Roblox")
    print(_0xd2e)

**What changed:** Identifiers renamed. Strings preserved.

**Size:** Same.

**Reversible in:** 2 minutes with any decompiler.

## Medium Preset Output

    local function _0xa3f(_0xb1c)
      return string.char(72, 101, 108, 108, 111, 44, 32) .. _0xb1c
    end
    local _0xd2e = _0xa3f(string.char(82, 111, 98, 108, 111, 120))
    print(_0xd2e)
    -- plus 5 dead code branches

**What changed:** Identifiers renamed. Strings encoded as char codes. Dead branches injected.

**Size:** ~2.5x.

**Reversible in:** 30-90 minutes.

## Heavy Preset Output

    -- Obfuscated with Lua Obf
    -- Preset: Heavy
    local _c = {45, 32, 79, 98, 102, 117, 115, 99, 97, 116, 101, 100, ...}
    local _s = string.char(unpack(_c))
    local _f = loadstring(_s)
    _f()
    -- (3 wrapper layers total)
    -- (strings XOR-encoded, numbers via lookup)
    -- (control flow flattened into state machine)
    -- (anti-tamper checks for debug.getinfo, getfenv, loadstring)

**What changed:** Everything.

**Size:** ~8x.

**Reversible in:** 1-3 days.

## A Realistic Example

**Input (a Roblox UI script):**

    local Players = game:GetService("Players")
    local player = Players.LocalPlayer
    
    local function onKeyPress(input)
      if input.KeyCode == Enum.KeyCode.E then
        print("E was pressed")
      end
    end
    
    game:GetService("UserInputService").InputBegan:Connect(onKeyPress)
    print("Loaded for " .. player.Name)

**Medium output (abbreviated):**

    local _0x1 = game:GetService(string.char(80, 108, 97, 121, 101, 114, 115))
    local _0x2 = _0x1.LocalPlayer
    
    local function _0x3(_0x4)
      if _0x4.KeyCode == Enum.KeyCode[string.char(69)] then
        print(string.char(69, 32, 119, 97, 115, ...))
      end
    end
    
    game:GetService(string.char(85, 115, 101, 114, ...)).InputBegan:Connect(_0x3)
    print(string.char(76, 111, 97, 100, ...) .. _0x2.Name)

**Note:** `game`, `Enum`, `print`, `Players`, `LocalPlayer`, `UserInputService`, `InputBegan`, `KeyCode`, `E` and other Roblox-specific names are protected and not renamed. Only string literals containing user-visible text are encoded.

**This is the point:** the structure is preserved (because it must be, to run in Roblox), but the surface text is scrambled.

## What Heavy Looks Like In Roblox Studio

Heavy preset output pastes into Roblox Studio without issue but is extremely dense. On a script over 500 lines:

- The Explorer shows one very long Script
- The code editor becomes slow (syntax highlighting lags)
- Errors become hard to trace (line numbers point to wrapper layers)

**For development, use Light. For shipping, use Medium or Heavy.**

## What Not to Expect

Lua Obf does **not** produce output that looks like Luraph. Luraph output has a specific visual signature (a long byte string, a hand-written VM, unusual syntax). Lua Obf output looks like normal Lua that was carefully mangled. This is intentional.

Lua Obf does **not** produce output that will fool a determined attacker. Every obfuscator has a shelf life. This one's is shorter than Luraph's.

Lua Obf does **not** protect secrets. Move secrets to the server.