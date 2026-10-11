import { Composition } from "remotion";
import { FPS } from "./edit";
import { SIZE } from "./layout";
import { BOOTH_LOGO_SECONDS, plan, Product } from "./Product";

export const Root: React.FC = () => {
  const { total } = plan(FPS);
  return (
    <>
      <Composition
        id="Product16x9"
        component={Product}
        defaultProps={{ format: "landscape" as const }}
        durationInFrames={total}
        fps={FPS}
        width={SIZE.landscape.width}
        height={SIZE.landscape.height}
      />
      <Composition
        id="Product16x9VO"
        component={Product}
        defaultProps={{ format: "landscape" as const, narration: true }}
        durationInFrames={total}
        fps={FPS}
        width={SIZE.landscape.width}
        height={SIZE.landscape.height}
      />
      <Composition
        id="Booth16x9"
        component={Product}
        defaultProps={{ format: "landscape" as const, booth: true }}
        durationInFrames={total + Math.round(BOOTH_LOGO_SECONDS * FPS)}
        fps={FPS}
        width={SIZE.landscape.width}
        height={SIZE.landscape.height}
      />
      <Composition
        id="Booth9x16"
        component={Product}
        defaultProps={{ format: "portrait" as const, booth: true }}
        durationInFrames={total + Math.round(BOOTH_LOGO_SECONDS * FPS)}
        fps={FPS}
        width={SIZE.portrait.width}
        height={SIZE.portrait.height}
      />
      <Composition
        id="Product9x16"
        component={Product}
        defaultProps={{ format: "portrait" as const }}
        durationInFrames={total}
        fps={FPS}
        width={SIZE.portrait.width}
        height={SIZE.portrait.height}
      />
    </>
  );
};
