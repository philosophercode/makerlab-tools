/**
 * Page text in four languages for the English-only tests (gateway spec
 * amendment 2026-09-26 "English resources only"). The same paragraph about
 * one printer, so only the language differs.
 */

export const ENGLISH =
  "The X2D is an enclosed 3D printer with two nozzles that can print with up to four materials at once. " +
  "Before you use the printer, make sure that the build plate is clean and that the filament is dry. " +
  "The heated chamber keeps the temperature stable, which is important for engineering materials such as ABS and ASA. " +
  "You should always remove the print from the plate after it has cooled, and you must not touch the nozzle while it is hot. ";

export const GERMAN =
  "Der X2D ist ein geschlossener 3D-Drucker mit zwei Düsen, der mit bis zu vier Materialien gleichzeitig drucken kann. " +
  "Bevor Sie den Drucker verwenden, stellen Sie sicher, dass die Druckplatte sauber ist und das Filament trocken ist. " +
  "Die beheizte Kammer hält die Temperatur stabil, was für technische Materialien wie ABS und ASA wichtig ist. " +
  "Entfernen Sie den Druck erst von der Platte, wenn er abgekühlt ist, und berühren Sie die Düse nicht, wenn sie heiß ist. ";

export const FRENCH =
  "La X2D est une imprimante 3D fermée avec deux buses qui peut imprimer avec quatre matériaux à la fois. " +
  "Avant d'utiliser l'imprimante, assurez-vous que le plateau est propre et que le filament est sec. " +
  "La chambre chauffée maintient la température stable, ce qui est important pour les matériaux techniques comme l'ABS. " +
  "Vous ne devez pas toucher la buse lorsqu'elle est chaude, et retirez la pièce du plateau après son refroidissement. ";

export const JAPANESE =
  "X2Dは2つのノズルを備えた密閉型3Dプリンターで、最大4種類の材料を同時に印刷できます。" +
  "プリンターを使用する前に、ビルドプレートが清潔でフィラメントが乾燥していることを確認してください。" +
  "加熱チャンバーは温度を安定させ、ABSやASAなどのエンジニアリング材料に重要です。";

/** `text`, `times` times over — long enough for several of the detector's windows. */
export function repeat(text: string, times: number): string {
  return Array.from({ length: times }, () => text).join("");
}
