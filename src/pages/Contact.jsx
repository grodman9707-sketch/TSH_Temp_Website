import { ArenaPage, Panel } from "../components/Layout.jsx";

export function Contact() {
  return (
    <ArenaPage>
      <Panel className="mx-auto max-w-lg text-center">
        <h1 className="text-3xl font-extrabold">Contact</h1>
        <p className="mt-3 text-muted-foreground">Questions about TSH Darts League go here.</p>
        <a className="mt-6 inline-block text-primary" href="mailto:thesocialhubinformation@gmail.com">
          thesocialhubinformation@gmail.com
        </a>
      </Panel>
      <div className="mx-auto mt-10 max-w-lg text-center">
        <h2 className="text-2xl font-extrabold">Admin team</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Owner, Deputy Admin, and Admin contact cards are generated when someone is given a staff role and removed when that role is taken away.
        </p>
      </div>
    </ArenaPage>
  );
}
