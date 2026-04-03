export function SecretHint({ set }: { set: boolean }) {
  return (
    <span className="text-[10px] text-muted-foreground">
      {set ? "A value is saved. Paste a new one to replace, or use Clear." : "Not set."}
    </span>
  );
}
