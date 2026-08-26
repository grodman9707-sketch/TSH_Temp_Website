import { ArenaPage, Panel } from "../components/Layout.jsx";

export function Contact() {
  return (
    <ArenaPage>
      <Panel className="mx-auto max-w-lg text-center">
        <h1 className="text-3xl font-extrabold">Contact</h1>
        <p className="mt-3 text-muted-foreground">Questions about TSH Darts League go here.</p>
        <div className="mt-6 space-y-4">
          <div>
            <div className="text-[11px] font-bold tracking-widest text-primary">SUPPORT</div>
            <a className="mt-1 inline-block text-lg font-bold text-primary" href="mailto:Support@tshdartsleague.com">
              Support@tshdartsleague.com
            </a>
          </div>
          <div>
            <div className="text-[11px] font-bold tracking-widest text-primary">LEAGUE INBOX</div>
            <a className="mt-1 inline-block text-primary" href="mailto:thesocialhubinformation@gmail.com">
              thesocialhubinformation@gmail.com
            </a>
          </div>
        </div>
      </Panel>
      <div className="mx-auto mt-10 max-w-lg text-center">
        <h2 className="text-5xl font-extrabold uppercase tracking-[0.22em]">Admin Team</h2>
        <p className="mt-4 inline-block bg-primary px-4 py-2 text-lg font-extrabold text-primary-foreground">
          Discord First! E-mail if that Fails!
        </p>
      </div>
    </ArenaPage>
  );
}
