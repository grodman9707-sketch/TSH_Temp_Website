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
    </ArenaPage>
  );
}
