# Parameters Panel

Document-scoped named numeric parameters that can be referenced by name in
sketch dimension expressions. Parameters are stored in `.polysmith` files
and re-evaluated on every change.

---

## Opening the Panel

- **Click** the `f(x)` button in the top ribbon.
- The panel floats below the button. Click outside to close.

---

## Adding a Parameter

1. Click **+ Add Parameter** in the panel.
2. **Name** field — type a unique, non-empty name.
3. **Expression** field — type a formula (e.g. `50`, `width * 2`).
4. **Kind** dropdown — select **Length** (mm) or **Angle** (degrees).
5. Selecting the kind **commits** the parameter immediately. The row
   closes and the parameter appears in the table.

### Expression Syntax

- Numbers: `50`, `3.14`
- Arithmetic: `+`, `-`, `*`, `/`
- Parentheses: `(a + b) / 3`
- Parameter references: `width`, `my_param`
- Unary minus: `-50`

Cycle detection is built-in.

### Kind Checking

- **Length** parameters store values in **mm**.
- **Angle** parameters store values in **degrees**.
- Angle parameters **cannot** be used in length-type dimensions — the
  core throws a descriptive error.

---

## Using Parameters in Dimensions

In any sketch dimension editor, type the parameter name instead of a
number. Parameters are resolved during draft (client-side, debounced
300ms), during edit (core-side evaluation), and on parameter change
(all dimension expressions re-evaluate automatically).

---

## IPC Commands

| Command              | Payload |
|----------------------|---------|
| `add_parameter`      | `{ name, expression, kind? }` |
| `update_parameter`   | `{ name, expression, kind? }` |
| `delete_parameter`   | `{ name }` |

---

## Response Shape

```ts
// document_state.parameters[]
{
  name: string;
  expression: string;
  resolved_value: number;  // mm for length, degrees for angle
  kind: "length" | "angle";
  has_error: boolean;
  error_message: string;
}
```
