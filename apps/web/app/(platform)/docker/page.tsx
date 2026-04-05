import { redirect } from "next/navigation";
import { isCloudEdition } from "@/lib/weehawk-edition";

export default function DockerIndexPage() {
  if (isCloudEdition()) {
    redirect("/remote-server");
  }
  redirect("/console/local/containers");
}
