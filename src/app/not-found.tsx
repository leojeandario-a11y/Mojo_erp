import Link from "next/link";

export default function NotFound() {
  return (
    <main className="message-page">
      <span className="eyebrow">404 · MOJOPIKTURES</span>
      <h1>Page introuvable · Paj sa a pa egziste · Page not found</h1>
      <p>La page demandée n’existe pas.</p>
      <Link className="button button-primary" href="/">Retour à l’accueil · Retounen · Home</Link>
    </main>
  );
}
