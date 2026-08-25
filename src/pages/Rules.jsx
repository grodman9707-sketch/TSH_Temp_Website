import { useEffect, useState } from "react";
import { ArenaPage, Panel } from "../components/Layout.jsx";
import { api } from "../lib/api.js";

function Blocks({ blocks }) {
  return (blocks || []).map((block, i) => {
    if (block.type === "ul") {
      return (
        <ul key={i} className="mt-2 list-disc space-y-1 pl-5">
          {(block.items || []).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    }
    if (block.type === "note") {
      return (
        <p key={i} className="mt-3 border-l-2 border-primary bg-primary/10 px-3 py-2 text-white">
          {block.text}
        </p>
      );
    }
    return (
      <p key={i} className="mt-2">
        {block.text}
      </p>
    );
  });
}

export function Rules() {
  const [rules, setRules] = useState(null);
  useEffect(() => {
    api("/api/rules")
      .then(setRules)
      .catch(() => {});
  }, []);
  const sections = rules?.sections || [];
  return (
    <ArenaPage>
      <Panel className="mx-auto max-w-3xl">
        <p className="text-xs font-semibold tracking-[0.3em] text-primary">TSH DARTS LEAGUE</p>
        <h1 className="mt-2 text-4xl font-extrabold">{rules?.title || "Rules"}</h1>
        <p className="mt-4 text-sm leading-relaxed text-white/80">{rules?.intro || ""}</p>
        <div className="mt-6 space-y-8 text-sm leading-relaxed text-white/80">
          {sections.map((section) => (
            <section key={section.id}>
              <h2 className="text-lg font-bold text-white">
                {section.id}. {section.title}
              </h2>
              <Blocks blocks={section.blocks} />
              {(section.subsections || []).map((sub) => (
                <div key={sub.id} className="mt-4">
                  <h3 className="font-semibold text-primary">
                    {sub.id} — {sub.title}
                  </h3>
                  <Blocks blocks={sub.blocks} />
                </div>
              ))}
            </section>
          ))}
        </div>
      </Panel>
    </ArenaPage>
  );
}
