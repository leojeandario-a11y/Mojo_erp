import Image from "next/image";
import Link from "next/link";

export function BrandLogo({
  href = "/dashboard",
  className = "",
  variant = "light",
}: {
  href?: string;
  className?: string;
  variant?: "light" | "dark";
}) {
  return (
    <Link href={href} className={`brand-lockup brand-image-lockup ${className}`.trim()} aria-label="MoJoPIKtures">
      <Image
        className="brand-logo-image"
        src={variant === "dark" ? "/mojo-logo-inverse.png" : "/mojo-logo.png"}
        alt="MoJoPIKtures"
        width={1820}
        height={820}
        priority
      />
      <span className="brand-mobile-mark" aria-hidden="true">MP</span>
    </Link>
  );
}
