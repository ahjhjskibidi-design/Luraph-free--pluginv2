# Deobfuscators

Know your enemy. These are the tools that reverse what Lua Obf does.

## General Lua Decompilers

**unluac**
- Java-based decompiler for Lua 5.1 bytecode
- Free, open source
- https://sourceforge.net/projects/unluac/

**luadec**
- C-based decompiler
- Handles Lua 5.1, 5.2, 5.3
- https://github.com/viruscamp/luadec

**ljd**
- LuaJIT bytecode decompiler
- Useful for scripts compiled with LuaJIT
- https://github.com/NightNz/ljd

## Roblox-Specific

**Konst**
- Deobfuscator for common Roblox obfuscators
- Handles IronBrew2, some Luraph outputs
- https://github.com/rce-io/konst

**MoonSec Deobf**
- Community tool for MoonSec-obfuscated scripts
- Not always up to date with the latest MoonSec

**Roblox-Exploits Deobf**
- Web-based, handles most common obfuscators
- https://wearedevs.net/obfuscator

**Byfron Deobfuscator**
- Handles bytecode from Roblox's own compiler
- Different from third-party obfuscators

## Web Tools

**de4js**
- Web-based JavaScript deobfuscator
- Not Lua, but the same idea
- https://lelinhtinh.github.io/de4js/

**Luraph Unpacker (community)**
- Attempts to unpack Luraph output
- Rarely successful against recent Luraph versions

## How Deobfuscators Work

1. **Static analysis** — read the code without running it
   - Detect `loadstring` layers
   - Fold constant arithmetic
   - Symbolic execution of state machines
2. **Dynamic analysis** — run the code in a sandbox
   - Trace every call
   - Dump the final executed bytecode
   - Reconstruct the original form
3. **Pattern matching** — recognize known obfuscator signatures
   - A specific XOR key, string char pattern, or wrapper shape

## Why This Matters

Every technique in this project is defeated by at least one of these tools. Knowing which one:

- **Renaming** → every decompiler undoes it
- **String char encoding** → runtime tracing recovers plaintext
- **Number hex/arith** → constant folding reverses it
- **Dead code** → visible in static analysis
- **Control flow flattening** → symbolic execution reverses it
- **loadstring layers** → one `loadstring` call reveals the next
- **Anti-tamper checks** → hook the checked function before running

The only defense that survives is **not having anything worth protecting in the script.**

## What to Do Instead

If you have real secrets:

1. **Move them server-side.** A webhook URL in a Roblox script is not secret, no matter how obfuscated.
2. **Use signed tokens.** The server issues a short-lived token the client cannot forge.
3. **Accept that client code is public.** Roblox scripts, like web frontends, are read by whoever has the client.
4. **Use obfuscation as a speed bump.** Not as a lock. Not as a safe.

## The Arms Race

Obfuscators and deobfuscators evolve together. Every time Luraph adds a technique, a new deobfuscator appears within weeks. This is not a war to win — it is a war to keep moving in.

Lua Obf accepts this. It is an obfuscator for the 80% of cases where a simple script benefits from a hint of protection. It is not a competitor to Luraph and does not pretend to be.