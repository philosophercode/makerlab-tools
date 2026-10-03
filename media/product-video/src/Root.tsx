import { Composition } from "remotion";
import { FPS } from "./edit";
import { SIZE } from "./layout";
import { plan, Product } from "./Product";

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
