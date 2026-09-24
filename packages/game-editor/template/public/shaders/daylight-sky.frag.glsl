varying vec3 vWorldPosition;
uniform vec3 uHorizonColor;
uniform vec3 uZenithColor;
uniform vec3 uSunColor;

void main() {
  vec3 direction = normalize(vWorldPosition - cameraPosition);
  float height = smoothstep(-0.08, 0.72, direction.y);
  vec3 color = mix(uHorizonColor, uZenithColor, height);
  vec3 sunDirection = normalize(vec3(-0.58, 0.36, -0.72));
  float sunDot = max(dot(direction, sunDirection), 0.0);
  color += uSunColor * pow(sunDot, 10.0) * 0.28;
  color += uSunColor * pow(sunDot, 620.0) * 1.8;
  gl_FragColor = vec4(color, 1.0);
}
