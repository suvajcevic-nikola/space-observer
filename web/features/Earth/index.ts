import { mat4, vec3 } from "wgpu-matrix";
import { makeScene, SceneInit } from "../../components/SceneLayout";
import { createSphereMesh, SphereLayout } from "../../meshes/sphere";

import meshWGSL from "./mesh.wgsl";

interface Renderable {
  vertices: GPUBuffer;
  indices: GPUBuffer;
  indexCount: number;
  bindGroup?: GPUBindGroup;
}

const init: SceneInit = async ({ canvas, pageState, gui, stats, data }) => {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter?.requestDevice();

  const dateKey = Object.keys(data?.near_earth_objects)?.[0];

  if (!pageState.active || !device) return;

  const settings = {
    useRenderBundles: true,
    asteroidCount: data?.near_earth_objects[dateKey]?.length || 0,
  };
  gui?.add(settings, "useRenderBundles");
  gui?.add(settings, "asteroidCount", 1000, 10000, 1000).onChange(() => {
    ensureEnoughAsteroids();
    updateRenderBundle();
  });

  const context = canvas.getContext("webgpu") as GPUCanvasContext;

  const devicePixelRatio = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format: presentationFormat,
    alphaMode: "premultiplied",
  });

  const shaderModule = device.createShaderModule({
    code: meshWGSL,
  });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vertexMain",
      buffers: [
        {
          arrayStride: SphereLayout.vertexStride,
          attributes: [
            {
              shaderLocation: 0,
              offset: SphereLayout.positionsOffset,
              format: "float32x3",
            },
            {
              shaderLocation: 1,
              offset: SphereLayout.normalOffset,
              format: "float32x3",
            },
            {
              shaderLocation: 2,
              offset: SphereLayout.uvOffset,
              format: "float32x2",
            },
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fragmentMain",
      targets: [
        {
          format: presentationFormat,
        },
      ],
    },
    primitive: {
      topology: "triangle-list",
      cullMode: "back",
    },

    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: "less",
      format: "depth24plus",
    },
  });

  const depthTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const uniformBufferSize = 4 * 16;
  const uniformBuffer = device.createBuffer({
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  let planetTexture: GPUTexture;
  {
    const response = await fetch(
      new URL("../../assets/img/earth.jpg", import.meta.url).toString()
    );
    const imageBitmap = await createImageBitmap(await response.blob());

    planetTexture = device.createTexture({
      size: [imageBitmap.width, imageBitmap.height, 1],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
      { source: imageBitmap },
      { texture: planetTexture },
      [imageBitmap.width, imageBitmap.height]
    );
  }

  let moonTexture: GPUTexture;
  {
    const response = await fetch(
      new URL("../../assets/img/moon.jpg", import.meta.url).toString()
    );
    const imageBitmap = await createImageBitmap(await response.blob());

    moonTexture = device.createTexture({
      size: [imageBitmap.width, imageBitmap.height, 1],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
      { source: imageBitmap },
      { texture: moonTexture },
      [imageBitmap.width, imageBitmap.height]
    );
  }

  const sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });

  const createSphereRenderable = (
    radius: number,
    widthSegments = 32,
    heightSegments = 16,
    randomness = 0
  ): Renderable => {
    const sphereMesh = createSphereMesh(
      radius,
      widthSegments,
      heightSegments,
      randomness
    );

    const vertices = device.createBuffer({
      size: sphereMesh.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });
    new Float32Array(vertices.getMappedRange()).set(sphereMesh.vertices);
    vertices.unmap();

    const indices = device.createBuffer({
      size: sphereMesh.indices.byteLength,
      usage: GPUBufferUsage.INDEX,
      mappedAtCreation: true,
    });
    new Uint16Array(indices.getMappedRange()).set(sphereMesh.indices);
    indices.unmap();

    return {
      vertices,
      indices,
      indexCount: sphereMesh.indices.length,
    };
  };

  const createSphereBindGroup = (
    texture: GPUTexture,
    transform: Float32Array
  ): GPUBindGroup => {
    const uniformBufferSize = 4 * 16;
    const uniformBuffer = device.createBuffer({
      size: uniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(uniformBuffer.getMappedRange()).set(transform);
    uniformBuffer.unmap();

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(1),
      entries: [
        {
          binding: 0,
          resource: {
            buffer: uniformBuffer,
          },
        },
        {
          binding: 1,
          resource: sampler,
        },
        {
          binding: 2,
          resource: texture.createView(),
        },
      ],
    });

    return bindGroup;
  };

  const transform = mat4.create();
  mat4.identity(transform);

  const planet = createSphereRenderable(1.0);
  planet.bindGroup = createSphereBindGroup(planetTexture, transform);

  const asteroids = [
    createSphereRenderable(0.01, 8, 6, 0.15),
    createSphereRenderable(0.013, 8, 6, 0.15),
    createSphereRenderable(0.017, 8, 6, 0.15),
    createSphereRenderable(0.02, 8, 6, 0.15),
    createSphereRenderable(0.03, 16, 8, 0.15),
  ];

  const renderables = [planet];

  function ensureEnoughAsteroids() {
    for (let i = renderables.length; i <= settings.asteroidCount; ++i) {
      const radius = Math.random() * 1.7 + 1.25;
      const angle = Math.random() * Math.PI * 2;
      const x = Math.sin(angle) * radius;
      const y = (Math.random() - 0.5) * 0.015;
      const z = Math.cos(angle) * radius;

      mat4.identity(transform);
      mat4.translate(transform, [x, y, z], transform);
      mat4.rotateX(transform, Math.random() * Math.PI, transform);
      mat4.rotateY(transform, Math.random() * Math.PI, transform);
      renderables.push({
        ...asteroids[i % asteroids.length],
        bindGroup: createSphereBindGroup(moonTexture, transform),
      });
    }
  }
  ensureEnoughAsteroids();

  const renderPassDescriptor: GPURenderPassDescriptor = {
    colorAttachments: [
      {
        view: undefined,

        clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
    depthStencilAttachment: {
      view: depthTexture.createView(),

      depthClearValue: 1.0,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    },
  };

  const aspect = canvas.width / canvas.height;
  const projectionMatrix = mat4.perspective(
    (2 * Math.PI) / 5,
    aspect,
    1,
    100.0
  );
  const modelViewProjectionMatrix = mat4.create();

  const frameBindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: {
          buffer: uniformBuffer,
        },
      },
    ],
  });

  function getTransformationMatrix() {
    const viewMatrix = mat4.identity();
    mat4.translate(viewMatrix, vec3.fromValues(0, 0, -3), viewMatrix);
    const now = Date.now() / 1000;
    mat4.rotateZ(viewMatrix, Math.PI * 0.1, viewMatrix);
    mat4.rotateX(viewMatrix, Math.PI * 0.1, viewMatrix);
    mat4.rotateY(viewMatrix, now * 0.05, viewMatrix);

    mat4.multiply(projectionMatrix, viewMatrix, modelViewProjectionMatrix);

    return modelViewProjectionMatrix as Float32Array;
  }

  function renderScene(
    passEncoder: GPURenderPassEncoder | GPURenderBundleEncoder
  ) {
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, frameBindGroup);

    let count = 0;
    for (const renderable of renderables) {
      passEncoder.setBindGroup(1, renderable.bindGroup);
      passEncoder.setVertexBuffer(0, renderable.vertices);
      passEncoder.setIndexBuffer(renderable.indices, "uint16");
      passEncoder.drawIndexed(renderable.indexCount);

      if (++count > settings.asteroidCount) {
        break;
      }
    }
  }

  let renderBundle;
  const updateRenderBundle = () => {
    const renderBundleEncoder = device.createRenderBundleEncoder({
      colorFormats: [presentationFormat],
      depthStencilFormat: "depth24plus",
    });
    renderScene(renderBundleEncoder);
    renderBundle = renderBundleEncoder.finish();
  };
  updateRenderBundle();

  const frame = () => {
    if (!pageState.active) return;

    stats?.begin();

    const transformationMatrix = getTransformationMatrix();
    device.queue.writeBuffer(
      uniformBuffer,
      0,
      transformationMatrix.buffer,
      transformationMatrix.byteOffset,
      transformationMatrix.byteLength
    );
    renderPassDescriptor.colorAttachments[0].view = context
      .getCurrentTexture()
      .createView();

    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);

    if (settings.useRenderBundles) {
      passEncoder.executeBundles([renderBundle]);
    } else {
      renderScene(passEncoder);
    }

    passEncoder.end();
    device.queue.submit([commandEncoder.finish()]);

    stats?.end();

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};

const RenderEarthScene: () => JSX.Element = () =>
  makeScene({
    gui: true,
    stats: true,
    init,
    sources: [
      {
        name: __filename.substring(__dirname.length + 1),
        contents: __SOURCE__,
      },
      {
        name: "./mesh.wgsl",
        contents: meshWGSL,
        editable: true,
      },
      {
        name: "../../meshes/sphere.ts",
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        contents: require("!!raw-loader!../../meshes/sphere.ts").default,
      },
    ],
    filename: __filename,
  });

export default RenderEarthScene;
