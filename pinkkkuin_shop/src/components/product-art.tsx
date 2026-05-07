import Image from "next/image";

type ProductArtProps = {
  image: string;
  name: string;
};

export function ProductArt({ image, name }: ProductArtProps) {
  return (
    <div className="relative aspect-square overflow-hidden rounded-[8px] bg-white">
      <Image src={image} alt={name} fill sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw" className="object-cover" />
    </div>
  );
}
