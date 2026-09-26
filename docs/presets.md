# Presets

Three levels, from light to maximum. Pick the smallest one that does the job.

## Light

**What it does:**

- Rename all local identifiers
- Minify whitespace
- Preserve strings and numbers as-is

**File size:** ~1.05x input.

**Runtime cost:** None.

**Reversal time:** 5-15 minutes with any Lua decompiler.

**Use when:**

- You want a hint of protection
- You do not need strong obfuscation
- The script is small and you want fast output

**Do not use when:**

- The script contains logic you actually need to hide

## Medium

**What it does:**

- Everything from Light
- Encode every string via `string.char`
- Encode every number as hex
- Inject dead code branches
- Wrap in 2 layers of `loadstring`

**File size:** ~2-3x input.

**Runtime cost:** 5-15% slower at load, negligible at runtime.

**Reversal time:** 1-2 hours.

**Use when:**

- You are sharing a script publicly
- You want to slow down copycats
- The script is not high-value

**Do not use when:**

- The script has thousands of lines (size grows fast)
- The script runs in a performance-critical loop

## Heavy

**What it does:**

- Everything from Medium
- XOR-encode strings with a per-run key
- Encode numbers via runtime lookup tables
- Flatten control flow into a state machine
- Wrap in 3 layers of `loadstring`
- Inject anti-tamper checks
- Larger dead code volume

**File size:** ~5-15x input.

**Runtime cost:** 15-40% slower at load, 5-10% at runtime.

**Reversal time:** 1-3 days for a competent attacker. Possibly longer for a novice.

**Use when:**

- The script is high-value (paid, exclusive, or competitive)
- You want the strongest protection this tool offers
- You accept the size and speed cost

**Do not use when:**

- The script runs on mobile or low-end hardware
- The script runs in a tight loop (obfuscation adds overhead)
- The script is under 200 lines (obfuscation ratio makes the output suspicious)
- You are using this inside Roblox Studio for iteration (use Light during dev)

## Choosing a Preset

    Is the script a work-in-progress?     → Light
    Is the script small and public?       → Medium
    Is the script paid or competitive?    → Heavy
    Is the script run every frame?        → Light
    Is the script run once at startup?    → Medium or Heavy

## Warning: Roblox Moderation

Heavy preset output is dense, unusual, and uses `loadstring` heavily. Some Roblox scripts get flagged by moderation for patterns that resemble malware. This is not unique to Lua Obf — all obfuscators trigger the same patterns.

If your script is moderated:

1. Try Medium preset instead
2. Reduce the number of wrapper layers
3. Remove anti-tamper checks
4. Consider whether obfuscation is worth the risk for this specific script

## Warning: Antivirus False Positives

Obfuscated Lua code resembles malware to antivirus engines. This is a known false positive, not a virus. Do not upload obfuscated scripts to scanners expecting a clean result.

## What No Preset Does

- Hide API keys or secrets (they are still in the code)
- Prevent decompilation by an expert
- Bypass Roblox anti-cheat
- Make code run faster
- Change what the code does

Obfuscation is a lock, not a wall. It raises the cost of the first attempt. It does not stop a determined attacker.