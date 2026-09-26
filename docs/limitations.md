# Limitations

Read this before relying on Lua Obf for anything valuable.

## Technical

**No real VM.** The wrapper falls back to `loadstring` layers. A bytecode VM would require a Lua compiler, which is beyond client-side JavaScript.

**No encrypted constants.** String XOR is not encryption. The key is in the code.

**Parser is incomplete.** Lua Obf uses a custom recursive-descent parser. It handles the common Lua 5.1 subset. It does **not** handle:

- `goto` and labels (Lua 5.2+)
- Some edge cases in long strings with mixed level markers
- Heavy metatable tricks that span statements
- Some `luau`-specific syntax (type annotations, `continue`, compound assignment)

If your script uses these, the parser will fail with a syntax error. Test on a small version first.

**Control flow flattening is naive.** It breaks with `return`, `break`, and locals that span statements. It skips those blocks.

**Anti-tamper is a signal, not a wall.** It detects debuggers but does not block them.

## Practical

**Size growth.** Heavy preset produces output 5-15x the input. A 500-line script becomes 3000-7000 lines.

**Runtime cost.** Heavy preset slows load time 15-40%. Runtime is affected 5-10%.

**Roblox moderation risk.** Dense `loadstring` usage resembles malware to some detection systems.

**Antivirus false positives.** The same patterns trigger AV warnings on desktop tools.

## What It Cannot Protect

**API keys, webhook URLs, secrets.**
If it is in the client script, it is exposed. Obfuscation does not change that. Move secrets to the server.

**Logic that runs on the client.**
The client has to run it, so the client can read it. Every obfuscator is defeated by tracing.

**Payment verification, authentication.**
Never trust client-side checks. Verify on the server.

**Anti-cheat.**
Roblox's own anti-cheat (Byfron/Hyperion) detects obfuscated scripts. Do not try to hide cheats behind obfuscation.

## What It Should Not Be Used For

- Hiding malware
- Bypassing Roblox moderation
- Avoiding antivirus detection
- Cheating in other games
- Any purpose that relies on the code being unreadable forever

## What It Is Good For

- Slowing copycats who lack deobfuscation skills
- Protecting minor IP (a unique algorithm, a specific UI flow)
- Adding a small hurdle before someone reads your script
- Learning how obfuscation works

## The Honest Summary

Lua Obf is a lock, not a wall. It raises the cost of a casual attack. It does not stop a determined one.

If your script contains a real secret, no obfuscator protects it. Move the secret.

If your script contains real value, no obfuscator protects it forever. Accept that it will be reversed, and make it valuable enough that reversing is worth less than buying.

If your script is small and public, Lua Obf works fine.