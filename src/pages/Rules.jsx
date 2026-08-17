import { ArenaPage, Panel } from "../components/Layout.jsx";

export function Rules() {
  return (
    <ArenaPage>
      <Panel className="mx-auto max-w-3xl">
        <p className="text-xs font-semibold tracking-[0.3em] text-primary">TSH DARTS LEAGUE</p>
        <h1 className="mt-2 text-4xl font-extrabold">Rules</h1>
        <div className="mt-6 space-y-4 text-sm leading-relaxed text-white/80">
          <p>The Social Hub Darts League (formerly World Darts League) is a competitive online league played on DartCounter.</p>
          <h2 className="text-lg font-bold text-white">Format</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>501, double out.</li>
            <li>Each regional has League 1, League 2, League 3, and League 4.</li>
            <li>Every match is Best of 9 (first to 5 legs).</li>
            <li>2 points for a match win. Legs for/against break ties.</li>
          </ul>
          <h2 className="text-lg font-bold text-white">Scheduling</h2>
          <p>Matches are listed on My Matches. Arrange a time with your opponent, play on DartCounter, then enter the result. Admins can override or create fixtures.</p>
          <h2 className="text-lg font-bold text-white">Conduct</h2>
          <p>Play fair, keep comms civil, and report issues to league admin. Repeat no-shows can result in a 0–walkover.</p>
        </div>
      </Panel>
    </ArenaPage>
  );
}
