import { redirect } from "next/navigation";
import { SubscriptionClient } from "./subscription-client";
import { isCloudEdition } from "@/lib/weehawk-edition";

export default function SubscriptionPage() {
  if (!isCloudEdition()) {
    redirect("/");
  }
  return <SubscriptionClient />;
}
