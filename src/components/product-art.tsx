import Image from "next/image";

type ProductArtProps = {
  image: string;
  name: string;
  variant?: "card" | "detail";
};

function cloudinaryImageUrl(image: string, variant: "card" | "detail") {
  if (!image.includes("/res.cloudinary.com/") || !image.includes("/upload/")) return image;
  const width = variant === "detail" ? 1200 : 600;
  return image.replace("/upload/", `/upload/c_limit,w_${width}/f_auto/q_auto/`);
}

export function ProductArt({ image, name, variant = "card" }: ProductArtProps) {
  const optimizedImage = cloudinaryImageUrl(image, variant);

  return (
    <div className="relative aspect-square overflow-hidden rounded-[8px] bg-white">
      <Image
        src={optimizedImage}
        alt={name}
        fill
        sizes={variant === "detail" ? "(max-width: 768px) 100vw, 50vw" : "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"}
        className="object-cover"
      />
    </div>
  );
}
