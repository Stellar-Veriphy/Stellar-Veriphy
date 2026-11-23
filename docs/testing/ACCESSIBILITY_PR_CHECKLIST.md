# Accessibility PR Checklist

This checklist applies to **all user-interface changes** (components, pages, modals, forms, etc.). Authors must complete relevant sections and link to test evidence. Reviewers verify minimum accessibility requirements are met.

## Quick Reference

| Area | Tools | Threshold |
|------|-------|-----------|
| Keyboard | Manual + axe-core | All interactions keyboard-accessible |
| Screen Reader | Manual + axe-core | Proper ARIA, labels, landmarks |
| Contrast | axe-core | WCAG AA (4.5:1 text, 3:1 UI) |
| Motion | Manual | `prefers-reduced-motion` respected |

---

## Pre-Flight Requirements

- [ ] **No new axe-core violations** — Run `pnpm test:a11y` locally
- [ ] **No new Jest a11y failures** — Run `pnpm test:a11y:components` locally  
- [ ] **Manual keyboard test completed** — Tab through all interactive elements
- [ ] **Screen reader test completed** — Navigate with NVDA/VoiceOver

---

## 1. Keyboard Accessibility

**Requirements:**
- All interactive elements reachable via Tab
- Focus order is logical and visual
- No keyboard traps
- Focus indicator visible (minimum 2:1 contrast)

**Test Evidence Required:**
- [ ] `pnpm test:a11y:pages` passes — no keyboard-related violations
- [ ] Manual test: Tab through entire flow
- [ ] Focus indicator screenshot (if modified)

**Common Issues:**
| Issue | Fix |
|-------|-----|
| Missing focus styles | Add `:focus-visible` styles with 2:1 contrast |
| Incorrect tab order | Use `tabIndex` or reorder DOM |
| Trap in modal | Ensure Escape closes, focus returns on close |
| Skip links missing | Add "Skip to main content" link |

**Link to test evidence:** _________________________________

---

## 2. Screen Reader Accessibility

**Requirements:**
- All images have alt text (or `alt=""` for decorative)
- Form inputs have associated labels
- Buttons/links have discernible text
- Landmarks present (`main`, `nav`, `footer`)
- Live regions for dynamic content
- Heading hierarchy is correct (h1 → h2 → h3)

**Test Evidence Required:**
- [ ] `pnpm test:a11y` passes — no ARIA/label violations
- [ ] NVDA/VoiceOver navigation test completed
- [ ] Screenshot of accessibility tree (optional)

**Common Issues:**
| Issue | Fix |
|-------|-----|
| Missing label | Add `<label for="id">` or `aria-label` |
| Empty button | Add text or `aria-label` |
| Missing landmarks | Add `<main>`, `<nav>`, `<footer>` |
| Missing heading | Add proper `<h1>`-`<h6>` |

**Link to test evidence:** _________________________________

---

## 3. Color Contrast (WCAG AA)

**Requirements:**
- Text: 4.5:1 contrast ratio (normal), 3:1 (large 18pt+)
- UI components: 3:1 contrast ratio
- Disabled states: Still meet minimums where applicable

**Test Evidence Required:**
- [ ] `pnpm test:a11y` passes — no contrast violations
- [ ] All new color combinations verified
- [ ] Dark mode contrast verified (if applicable)

**Quick Contrast Check:**
```
Normal text (< 18pt):  4.5:1 minimum
Large text (≥ 18pt):   3:1 minimum
UI components:         3:1 minimum
```

**Link to test evidence:** _________________________________

---

## 4. Motion & Animation

**Requirements:**
- `prefers-reduced-motion` respected
- No flashing content (>3 flashes/second)
- Auto-playing media has controls
- Loading states don't block interaction

**Test Evidence Required:**
- [ ] Disable animations in OS, verify no jarring behavior
- [ ] Check for seizure-triggering content
- [ ] Verify animations are under 500ms or have reduction option

**Quick Test:**
```bash
# macOS: System Settings → Accessibility → Display → Reduce motion
# Windows: Settings → Accessibility → Motion → Reduce motion
```

**Link to test evidence:** _________________________________

---

## 5. Touch & Mobile (if applicable)

**Requirements:**
- Touch targets minimum 44x44 CSS pixels
- No horizontal scroll at 320px viewport
- Text scalable to 200% without loss

**Test Evidence Required:**
- [ ] Test on mobile device or responsive viewport
- [ ] Verify tap targets in mobile DevTools

**Link to test evidence:** _________________________________

---

## Test Evidence Templates

### Automated Test Output

```
pnpm test:a11y --reporter=list

✓ e2e/accessibility.spec.ts — 12 passed
✓ src/components/Button.accessibility.test.tsx — 5 passed
```

### Manual Keyboard Test Log

| Step | Action | Expected | Actual | Pass |
|------|--------|----------|--------|------|
| 1 | Tab to search | Focus on input | Focus on input | ✅ |
| 2 | Enter "test" | Input receives text | Input receives text | ✅ |
| 3 | Tab to submit | Focus on button | Focus on button | ✅ |
| 4 | Enter | Form submits | Form submits | ✅ |

### Screen Reader Notes

> Tested with NVDA on Firefox. Form labels read correctly. Modal focus trap works. Error messages announced via `aria-live`.

---

## Reviewer Sign-Off

**Reviewer:** _________________ **Date:** _____________

- [ ] All checklist items addressed
- [ ] Test evidence provided and reviewed
- [ ] No blocking accessibility issues
- [ ] Minimum WCAG AA compliance confirmed

**Notes:** _____________________________________________

---

## Related Resources

- [MDN Accessibility Guide](https://developer.mozilla.org/en-US/docs/Web/Accessibility)
- [WCAG 2.1 Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/)
- [axe-core Documentation](https://www.deque.com/axe/)
- [Stellar Veriphy Testing Guide](../TESTING_GUIDE.md)