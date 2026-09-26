# Techniques

Every obfuscation technique used by Lua Obf, explained.

## 1. Identifier Renaming

**What:** Replace every local variable, function, and parameter name with a random identifier.

**Input:**
    local greeting = "Hello"
    local function greet(name)
      return greeting .. ", " .. name
    end

**Output:**
    local _0xa3f = "Hello"
    local function _0xb1c(_0xd2e)
      return _0xa3f .. ", " .. _0xd2e
    end

**Why:** Removes all semantic information from the source. `greeting`, `greet`, `name` tell a story. `_0xa3f`, `_0xb1c`, `_0xd2e` tell nothing.

**Limits:** Globals are never renamed. Roblox standard library names (`game`, `workspace`, `Instance`, `Vector3`, etc.) are protected.

**Reversal difficulty:** Trivial. Any Lua decompiler recovers the code shape. Names are the only thing lost, and they can be guessed from context.

## 2. String Encoding

**What:** Replace string literals with expressions that compute the same string at runtime.

**Method A — char codes:**

    "Hello"   →   string.char(72, 101, 108, 108, 111)

**Method B — hex escape:**

    "Hello"   →   "\72\101\108\108\111"

**Method C — XOR + char:**

Each character is XORed with a session key, then reconstructed at runtime. The key is regenerated per obfuscation, so no two outputs share the same byte pattern.

**Why:** Defeats naïve string search. A grep for `"password"` finds nothing.

**Limits:** A deobfuscator with runtime tracing recovers the plaintext in seconds.

**Reversal difficulty:** Easy for tools, moderate for humans.

## 3. Number Obfuscation

**What:** Replace number literals with expressions.

**Method A — hex:**

    100   →   0x64

**Method B — arithmetic:**

    100   →   (47 + 53)

**Method C — lookup:**

    100   →   ({100})[1]

**Why:** Breaks constant folding by tools that scan for specific numbers.

**Reversal difficulty:** Trivial. Any decompiler folds these.

## 4. Dead Code Injection

**What:** Insert branches that never execute.

**Example:**

    if 1 == 2 then
      print("this never runs")
    end
    if false then
      local x = 42
    end

**Why:** Increases file size and confuses readers. The attacker has to check each branch to see if it matters.

**Limits:** A smart reader skips obvious dead code. A decompiler shows it clearly.

**Reversal difficulty:** Easy — dead branches are visible.

## 5. Control Flow Flattening

**What:** Take a linear sequence of statements and turn it into a state-machine loop.

**Input:**

    local a = 1
    print(a)
    print(a + 1)

**Output:**

    local _s = 1
    while _s ~= 0 do
      if _s == 1 then
        local a = 1
        _s = 2
      elseif _s == 2 then
        print(a)
        _s = 3
      elseif _s == 3 then
        print(a + 1)
        _s = 0
      end
    end

**Why:** Destroys the visual flow. A reader can no longer scan top-to-bottom.

**Limits:** Decompilers reconstruct the linear form. Also breaks with `return`, `break`, and locals that span statements.

**Reversal difficulty:** Moderate for humans, easy for tools.

## 6. Multi-Layer Wrapping

**What:** Encode the entire script as a byte array, wrap in `loadstring`, repeat.

**Example (2 layers):**

    local _c = {112, 114, 105, 110, 116, 40, ...}
    local _s = string.char(unpack(_c))
    local _f = loadstring(_s)
    _f()

**Why:** The literal source never appears. Only byte arrays.

**Limits:** Trivial to unwrap — one `loadstring` call reveals the next layer. Still useful against casual inspection.

**Reversal difficulty:** Easy, but tedious with many layers.

## 7. Anti-Tamper

**What:** Insert guards that detect debugging environments.

**Example:**

    if debug and debug.getinfo then
      local ok = pcall(function() return debug.getinfo(1) end)
    end
    if loadstring == nil and load == nil then
      return
    end

**Why:** Detects sandboxes without `loadstring`, or environments where `debug` is hooked.

**Limits:** Determined attackers hook these functions before running your script. The check is a signal, not a wall.

**Reversal difficulty:** Easy — the checks are visible in the output.

## 8. What This Does Not Do

**No bytecode VM.** The wrapper falls back to `loadstring` layers. A real VM (Luraph, MoonSec) compiles Lua to custom bytecode and runs a custom interpreter. This project does not implement one.

**No encrypted constants.** String XOR is not encryption. Real obfuscators use a key derivation that resists offline analysis.

**No control flow obfuscation at the VM level.** Our flattening is at the AST level. Real obfuscators insert opaque predicates, bogus branches, and jump tables.

**No anti-debug hardening.** We check for `debug.getinfo`. Real obfuscators detect breakpoints, tamper with debug hooks, and self-modify.

## 9. Reversal Tool Comparison

| Tool | Our light | Our medium | Our heavy | Luraph heavy |
|------|-----------|------------|-----------|--------------|
| Time to reverse | 5 min | 1-2 hours | 1-3 days | 1-4 weeks |
| Skill required | None | Beginner | Intermediate | Expert |
| Tools available | Any decompiler | Konst / MoonSec deobf | Same + manual | Custom work |

The honest summary: **this project slows attackers. It does not stop them.**