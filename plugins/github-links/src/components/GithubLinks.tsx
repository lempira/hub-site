import type {
  QuartzComponent,
  QuartzComponentConstructor,
  QuartzComponentProps,
} from "@quartz-community/types"

export interface GithubLinksOptions {
  /** "OWNER/REPO" holding the markdown this site renders. */
  repo: string
  /** Branch the Source link points at. */
  branch?: string
  /** Prepended to the page path, if the vault is a subdirectory of the repo. */
  pathPrefix?: string
}

export default ((opts?: GithubLinksOptions) => {
  const repo = opts?.repo ?? ""
  const branch = opts?.branch ?? "main"
  const prefix = opts?.pathPrefix ?? ""

  const GithubLinks: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
    const rel = fileData?.relativePath as string | undefined
    // Folder, tag and 404 pages are generated — they have no source file.
    if (!repo || !rel) return null

    const repoPath = `${prefix}${rel}`
    const encoded = repoPath.split("/").map(encodeURIComponent).join("/")
    const source = `https://github.com/${repo}/blob/${branch}/${encoded}`
    const discuss = `https://github.com/${repo}/issues/new?title=${encodeURIComponent(repoPath)}`

    return (
      <div class={`gh-links ${displayClass ?? ""}`}>
        <a href={discuss} target="_blank" rel="noopener noreferrer">
          Discuss this page
        </a>
        <a href={source} target="_blank" rel="noopener noreferrer">
          Source
        </a>
      </div>
    )
  }

  GithubLinks.css = `
    .gh-links { display: flex; gap: 1rem; margin-top: 2rem; font-size: 0.9rem; }
    .gh-links a { color: var(--gray); text-decoration: none; }
    .gh-links a:hover { color: var(--secondary); }
  `

  return GithubLinks
}) satisfies QuartzComponentConstructor<GithubLinksOptions>
