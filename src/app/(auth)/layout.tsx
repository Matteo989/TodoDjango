export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">
            IA<span className="text-primary">vid</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Usine à contenu vertical — DIY, bricolage et maison
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
