import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

import type { GUI } from "dat.gui";

import styles from "./SceneLayout.module.css";

type SourceFileInfo = {
  name: string;
  contents: string;
  editable?: boolean;
};

export type SceneInit = (params: {
  canvas: HTMLCanvasElement;
  pageState: { active: boolean };
  gui?: GUI;
  stats?: Stats;
  data?: unknown;
}) => void | Promise<void>;

const SceneLayout: React.FunctionComponent<
  React.PropsWithChildren<{
    originTrial?: string;
    filename: string;
    init: SceneInit;
    sources: SourceFileInfo[];
    gui?: boolean;
    stats?: boolean;
  }>
> = (props) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const guiParentRef = useRef<HTMLDivElement | null>(null);
  const statsParentRef = useRef<HTMLDivElement | null>(null);

  const { data } = useQuery({
    queryKey: ["getAsteroids"],
    queryFn: () => {
      return fetch("https://www.neowsapp.com/rest/v1/feed/today").then((res) =>
        res.json()
      );
    },
  });

  const gui: GUI | undefined = useMemo(() => {
    if (props.gui && process.browser) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const dat = require("dat.gui");
      return new dat.GUI({ autoPlace: false });
    }
    return undefined;
  }, []);

  const stats: Stats | undefined = useMemo(() => {
    if (props.stats && process.browser) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Stats = require("stats-js");
      return new Stats();
    }
    return undefined;
  }, []);

  useEffect(() => {
    if (gui && guiParentRef.current) {
      guiParentRef.current.appendChild(gui.domElement);
    }

    if (stats && statsParentRef.current) {
      stats.dom.style.position = "absolute";
      stats.showPanel(1);
      statsParentRef.current.appendChild(stats.dom);
    }

    const pageState = {
      active: true,
    };
    const cleanup = () => {
      pageState.active = false;
    };
    try {
      const canvas = canvasRef.current;
      if (!canvas) {
        throw new Error("The canvas is not available");
      }

      if (!data) return;

      const p = props.init({
        canvas,
        pageState,
        gui,
        stats,
        data,
      });

      if (p instanceof Promise) {
        p.catch((err: Error) => {
          console.error(err);
        });
      }
    } catch (err) {
      console.error(err);
    }
    return cleanup;
  }, [data]);

  return (
    <main>
      <div className={styles.canvasContainer}>
        {/* <div
          style={{
            position: "absolute",
            right: 10,
          }}
          ref={guiParentRef}
        /> */}
        <canvas ref={canvasRef}></canvas>
      </div>
    </main>
  );
};

export default SceneLayout;

export const makeScene: (
  ...props: Parameters<typeof SceneLayout>
) => JSX.Element = (props) => {
  return <SceneLayout {...props} />;
};

export function assert(condition: unknown, msg?: string): asserts condition {
  if (!condition) {
    throw new Error(msg);
  }
}
