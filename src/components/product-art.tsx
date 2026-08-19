import Image from "next/image";

type ProductArtProps = {
  image?: string;
  name: string;
  width?: number;
};

function optimizeCloudinary(image: string, width: number) {
  if (!image.includes("/res.cloudinary.com/") || !image.includes("/upload/")) return image;
  return image.replace("/upload/", `/upload/f_auto,q_auto,c_limit,w_${width}/`);
}

export function ProductArt({ image, name, width = 600 }: ProductArtProps) {
  if (!image) {
    return (
      <div className="grid aspect-square place-items-center rounded-2xl bg-gradient-to-br from-penguin-pink-light to-penguin-yellow text-5xl">
        🐧
      </div>
    );
  }

  return (
    <div className="relative aspect-square overflow-hidden rounded-2xl bg-gradient-to-br from-penguin-pink-light to-penguin-yellow">
      <Image
        src={optimizeCloudinary(image, width)}
        alt={name}
        fill
        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
        className="object-cover transition duration-300 group-hover:scale-105"
      />
    </div>
  );
}
