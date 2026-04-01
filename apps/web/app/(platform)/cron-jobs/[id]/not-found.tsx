import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export default function CronJobNotFound() {
  return (
    <>
      <div className="text-center mt-20">
        <ShieldAlert className="w-16 h-16 text-destructive mx-auto mb-4" />
        <h2 className="text-2xl font-bold mb-2">Cron job not found</h2>
        <Link href="/cron-jobs">
          <button type="button" className="btn-primary">Back to cron jobs</button>
        </Link>
      </div>
    </>
  );
}
