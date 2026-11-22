import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useI18n } from "../i18n";
import { aiGuide } from "../lib/aiGuide";
import { copyText } from "../lib/clipboard";
import { mcpBaseUrl } from "../lib/mcp";

/**
 * Pagina "Guida AI" (/guide): configurazione di My Planner e di Claude per i
 * task gestiti da AI. Testo in lib/aiGuide.ts; `codice` e **grassetto** sono
 * resi qui senza HTML grezzo.
 */

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function GuidePage() {
  const { t, locale } = useI18n();
  const [copied, setCopied] = useState(false);
  const location = useLocation();
  // Link diretti a una sezione (es. /guide#guide-routine dalle impostazioni del progetto).
  useEffect(() => {
    if (!location.hash) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [location.hash]);
  const globalUrl = `${mcpBaseUrl()}/mcp/global`;
  const guide = useMemo(() => {
    const fill = (s: string) => s.replaceAll("{globalUrl}", globalUrl).replaceAll("{appUrl}", window.location.origin);
    const g = aiGuide(locale);
    return {
      ...g,
      intro: fill(g.intro),
      requirements: fill(g.requirements),
      sections: g.sections.map((s) => ({
        ...s,
        paragraphs: s.paragraphs?.map(fill),
        steps: s.steps?.map(fill),
        bullets: s.bullets?.map(fill),
        tip: s.tip ? fill(s.tip) : undefined,
      })),
    };
  }, [locale, globalUrl]);

  async function handleCopy() {
    if (await copyText(globalUrl)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className="guide-page">
      <article className="guide-card">
        <h2 className="guide-title">{guide.title}</h2>
        <p className="guide-intro">{renderInline(guide.intro)}</p>
        <p className="guide-requirements">{renderInline(guide.requirements)}</p>

        <nav className="guide-toc" aria-label={t.guide.contents}>
          <span className="field-label">{t.guide.contents}</span>
          <ol>
            {guide.sections.map((s) => (
              <li key={s.id}>
                <a href={`#guide-${s.id}`}>{s.title.replace(/^\d+\.\s*/, "")}</a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="token-reveal-row guide-url">
          <code>{globalUrl}</code>
          <button type="button" onClick={handleCopy}>
            {copied ? t.guide.copied : t.guide.copy}
          </button>
        </div>

        {guide.sections.map((s) => (
          <section key={s.id} id={`guide-${s.id}`} className="guide-section">
            <h3>{s.title}</h3>
            {s.paragraphs?.map((p, i) => <p key={i}>{renderInline(p)}</p>)}
            {s.steps && (
              <ol className="guide-steps">
                {s.steps.map((step, i) => (
                  <li key={i}>{renderInline(step)}</li>
                ))}
              </ol>
            )}
            {s.bullets && (
              <ul className="guide-bullets">
                {s.bullets.map((b, i) => (
                  <li key={i}>{renderInline(b)}</li>
                ))}
              </ul>
            )}
            {s.tip && <p className="guide-tip">{renderInline(s.tip)}</p>}
          </section>
        ))}
      </article>
    </div>
  );
}
