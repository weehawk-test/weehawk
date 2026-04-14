import { redirect } from "next/navigation";

type ListSearch = { page?: string; q?: string };

/** Legacy `/docker/...` routes forward here with query preserved */
export function redirectToLocalConsole(subpath: string, sp: ListSearch): never {
  const q = new URLSearchParams();
  if (typeof sp.page === "string" && sp.page) q.set("page", sp.page);
  if (typeof sp.q === "string" && sp.q) q.set("q", sp.q);
  void subpath;
  void q;
  redirect("/remote-server");
}
