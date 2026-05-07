# 0042 - Brigther background

**Milestone:** M9

## Goal
Make the background of the world view brighter

## Outcome
The background of the world view will be like a dark grey and it will be added to this issue where to change that, if another color is needed

## Where to change the color

`frontend/src/world/Scene.tsx`, line 27:

```tsx
<color attach="background" args={["#2d2d2d"]} />
```

Change the hex value in `args` to any color you want for the world view background.