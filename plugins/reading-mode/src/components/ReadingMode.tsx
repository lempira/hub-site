import type {
  QuartzComponent,
  QuartzComponentConstructor,
  QuartzComponentProps,
} from "@quartz-community/types"

/**
 * Reading mode is a DESTINATION, not a preference.
 *
 * Entering appends `?read` to the URL and pushes one history entry, so the
 * browser back button, a trackpad swipe and Escape are all genuine ways out.
 * The state lives only in the URL: it survives a reload, it can be shared, and
 * it does not follow you to the next note.
 *
 * Entry deliberately does NOT go through Quartz's router. `isSamePage` ignores
 * `url.search` (spa.inline.ts:21-25), so a plain `?read` link reads as a
 * different page and would trigger a full fetch + micromorph + `<head>` rebuild
 * for what is a purely presentational change — and `_navigate` scrolls to top
 * on the way (spa.inline.ts:119), throwing away the reader's place. Intercepting
 * the click and calling pushState ourselves makes entry instant and leaves the
 * scroll position untouched.
 */
export default (() => {
  const ReadingMode: QuartzComponent = ({ displayClass }: QuartzComponentProps) => (
    <div class={`reading-mode ${displayClass ?? ""}`}>
      <a
        class="reading-mode-enter"
        href="?read"
        role="button"
        aria-label="Read without distractions"
        title="Read without distractions"
      >
        <svg
          aria-hidden="true"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M2 5h7a3 3 0 0 1 3 3v11a2.5 2.5 0 0 0-2.5-2.5H2Z" />
          <path d="M22 5h-7a3 3 0 0 0-3 3v11a2.5 2.5 0 0 1 2.5-2.5H22Z" />
        </svg>
      </a>
      <button class="reading-mode-exit" type="button" aria-label="Leave reading mode">
        Done
      </button>
    </div>
  )

  // Cosmetics only — the layout overrides live in quartz/styles/custom.scss,
  // which is the one stylesheet emitted OUTSIDE `@layer quartz-base`
  // (componentResources.ts:347 vs :411) and so can beat base.scss without
  // specificity games.
  ReadingMode.css = `
    .reading-mode { display: flex; align-items: center; }
    .reading-mode-enter {
      display: flex; align-items: center; justify-content: center;
      width: 2rem; height: 2rem;
      color: var(--darkgray); text-decoration: none; border-radius: 4px;
    }
    .reading-mode-enter:hover { color: var(--secondary); background: var(--lightgray); }
    /* Hidden until reading mode is on; custom.scss reveals it. */
    .reading-mode-exit { display: none; }
  `

  // Runs once, in <head>, before first paint: a cold load or a reload of a
  // `?read` URL must not flash the chrome before the CSS applies.
  ReadingMode.beforeDOMLoaded = `
    try {
      if (new URLSearchParams(window.location.search).has("read")) {
        document.documentElement.setAttribute("data-reading", "")
      }
    } catch (e) {}
  `

  ReadingMode.afterDOMLoaded = `
    if (!window.__readingModeBound) {
      window.__readingModeBound = true

      var READ = "read"
      // Whether THIS document pushed the reading entry. False after a reload or
      // on a cold-loaded shared link — which is exactly when history.back()
      // would leave the site instead of exiting reading mode.
      var pushedByUs = false

      function isReading() {
        return new URLSearchParams(window.location.search).has(READ)
      }

      function apply(on) {
        if (on) document.documentElement.setAttribute("data-reading", "")
        else document.documentElement.removeAttribute("data-reading")
      }

      function withRead(want) {
        var u = new URL(window.location.href)
        var params = new URLSearchParams(u.search)
        params.delete(READ)
        var rest = params.toString()
        var query = want ? "?" + (rest ? rest + "&" : "") + READ : rest ? "?" + rest : ""
        return u.pathname + query + u.hash
      }

      function enter() {
        if (isReading()) return
        history.pushState(history.state, "", withRead(true))
        pushedByUs = true
        apply(true)
      }

      function leave() {
        if (!isReading()) return
        apply(false)
        if (pushedByUs) {
          pushedByUs = false
          history.back()
        } else {
          // replaceState, never a forward navigation: pushing the clean URL on
          // top would leave ?read one step BACK, so the next back press would
          // bounce the reader straight into reading mode again.
          history.replaceState(history.state, "", withRead(false))
        }
      }

      // Capture phase on document, so this runs before the router's
      // window-level bubble handler; stopPropagation keeps it from navigating.
      document.addEventListener("click", function (e) {
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
        var el = e.target && e.target.nodeType === 1 ? e.target : null
        if (!el) return
        if (el.closest(".reading-mode-enter")) {
          e.preventDefault(); e.stopPropagation(); enter(); return
        }
        if (el.closest(".reading-mode-exit")) {
          e.preventDefault(); e.stopPropagation(); leave()
        }
      }, true)

      document.addEventListener("keydown", function (e) {
        if (e.key !== "Escape" || !isReading()) return
        if (e.ctrlKey || e.metaKey || e.altKey) return
        var ae = document.activeElement
        if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return
        // The search modal owns Escape while it is open.
        if (document.querySelector(".search-container.active")) return
        e.preventDefault()
        leave()
      })

      // Re-sync on every SPA navigation, including popstate-driven ones.
      // Following any link leaves reading mode, because the new URL has no ?read.
      document.addEventListener("nav", function () {
        var reading = isReading()
        apply(reading)
        if (!reading) pushedByUs = false
      })
    }
  `

  return ReadingMode
}) satisfies QuartzComponentConstructor
