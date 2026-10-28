"use client";

import Link from "next/link";
import { FileStatus } from "@/lib/productionFiles";

/**
 * Labels "Catalogus" / "Map" / "Voorstel?" / "Geen bestanden" op de productenlijst (kaartjes en lijst).
 * Catalogus opent het model in de Catalogus; de andere gaan naar het blok Productiebestanden op de productpagina.
 */
export default function FileBadges({ productId, status }: { productId: string; status: FileStatus | undefined }) {
  const files = `/products/${productId}#productiebestanden`;
  return (
    <span className="file-badges">
      {status?.modelId && (
        <Link href={`/catalog?model=${status.modelId}`} className="file-badge catalog" title="Dit product komt uit de catalogus -- model openen">Catalogus</Link>
      )}
      {status?.hasFolder ? (
        <Link href={files} className="file-badge folder" title="Productiebestanden gekoppeld">Map</Link>
      ) : status?.hasSuggestion ? (
        <Link href={files} className="file-badge suggestion" title="De agent stelde een map voor -- bevestigen op de productpagina">Voorstel?</Link>
      ) : (
        <Link href={files} className="file-badge none" title="Nog geen productiebestanden gekoppeld">Geen bestanden</Link>
      )}
    </span>
  );
}
