import { redirect } from "next/navigation";

export default function DockerIndexPage() {
  redirect("/docker/images");
}
