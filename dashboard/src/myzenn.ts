// Deep links into the live MyZenn web app. Routes are taken from myzenn.com's own router.
export const MYZENN = "https://www.myzenn.com";

const ROUTES: Record<string, string> = {
  MyBreath: "/mysanctuary/mybreath",
  MyBody: "/mysanctuary/mybody",
  MyPeace: "/mysanctuary/mypeace",
  MyYoga: "/yoga/flow",
  MyResources: "/mysanctuary/resources",
  MyWheel: "/mysanctuary/mywheel",
  MyGuru: "/myguru",
  MySafe: "/mysafe",
};

/** URL of the first MyZenn tool named in a label like "MyBody + MyPeace", or null if none has a page. */
export function myzennUrl(label: string): string | null {
  const hit = label.split(/\s*\+\s*|\s+/).find(w => ROUTES[w]);
  return hit ? MYZENN + ROUTES[hit] : null;
}
